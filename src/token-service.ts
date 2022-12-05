"use strict";
import { Mutex } from "async-mutex";
import { LocalStorageCompatible } from "./storage";
import { Tokens } from "./tokens";

///////////
// Types //
///////////

type RefreshCallback = (
  refreshToken: string,
  setLoggedOut: () => void
) => Promise<Tokens>;
interface Status {
  accessToken: string;
  accessTokenExp: number;
  refreshToken: string;
  refreshTokenExp: number;
  loggedIn: boolean;
  accessTokenValid: boolean;
}
type Subscriber = (status: Status) => void;

///////////////////////////////
// Constants & initial state //
///////////////////////////////

const LOCAL_STORAGE_STATUS_KEY = "authStatus";
const GET_TOKEN_LOCK = "multitab-token-access-lock";
const LOGGED_OUT_ERROR = Error("Logged out");
const BASE_STATUS: Status = {
  accessToken: "",
  accessTokenExp: 0,
  refreshToken: "",
  refreshTokenExp: 0,
  loggedIn: false,
  accessTokenValid: false,
};

const MIN_TOKEN_TTL = 5;
const supportsWebLocksApi = !!(
  typeof navigator !== "undefined" && navigator.locks?.request
);

class TokenService {
  /**
   * Token handling service. Must be initiated with an async refresh callback.
   *
   * Optionally, the storage mechanism (default LocalStorage),
   * mutex lock name and storage key can be overridden.
   */
  private refreshCallback: RefreshCallback;
  private storage: LocalStorageCompatible;
  private statusSubscribers: Subscriber[] = [];
  private mutex = new Mutex();
  private lockName: string;
  private storageKey: string;

  public constructor(
    refreshCallback: RefreshCallback,
    options: {
      storage?: LocalStorageCompatible;
      lockName?: string;
      storageKey?: string;
    } = {}
  ) {
    this.refreshCallback = refreshCallback;
    this.storage = options.storage || localStorage;
    this.lockName = options.lockName || GET_TOKEN_LOCK;
    this.storageKey = options.storageKey || LOCAL_STORAGE_STATUS_KEY;
  }

  ////////////
  // Status //
  ////////////

  /**
   * Get the current status from storage, deserialized and with updated `loggedIn` and `accessTokenValid` fields.
   */
  public getStatus(): Status {
    let serializedStatus = this.storage.getItem(this.storageKey);
    serializedStatus = serializedStatus == null ? "{}" : serializedStatus;
    const status = createNewStatus(JSON.parse(serializedStatus));
    return status;
  }

  /**
   * Save a status to storage.
   */
  private saveStatus(status: Status): void {
    this.storage.setItem(this.storageKey, JSON.stringify(status));
    console.log("New auth status stored.");
  }

  /**
   * Delete the current status in storage
   */
  private deleteStatus(): void {
    this.storage.removeItem(this.storageKey);
  }

  /**
   * Save a status to storage and notify subscribers of the new status.
   */
  private saveAndPublishStatus(status: Status): void {
    this.saveStatus(status);
    this.notifyStatusUpdate();
  }

  //////////////
  // "PubSub" //
  //////////////

  /**
   * Register a subscriber to receive status updates.
   */
  public subscribeStatusUpdates(subscriber: Subscriber): void {
    this.statusSubscribers.push(subscriber);
    this.sendCurrentStatus(subscriber);
  }

  /**
   * Send the current status to a single subscriber
   */
  private sendCurrentStatus(subscriber: Subscriber, status?: Status): void {
    status = status ?? this.getStatus();
    subscriber(status);
  }

  /**
   * Notify registered subscribers of status updates.
   */
  private notifyStatusUpdate(): void {
    const status = this.getStatus();
    this.statusSubscribers.forEach((sub) =>
      this.sendCurrentStatus(sub, status)
    );
  }

  ////////////////////////////
  // The actual token stuff //
  ////////////////////////////

  /**
   * Returns a promise that will resolve to the access token.
   * Refreshes the tokens if necessary.
   * Access is synchronized across tabs in browsers that support the Web Locks API.
   */
  public async getAccessToken(): Promise<string> {
    return supportsWebLocksApi
      ? navigator.locks.request(this.lockName, () =>
          this.getAccessTokenNonSynchronized()
        )
      : this.mutex.runExclusive(() => this.getAccessTokenNonSynchronized());
  }

  /**
   * Get an access token in a promise, if we are logged-in.
   */
  private async getAccessTokenNonSynchronized(): Promise<string> {
    const currentStatus = this.getStatus();
    if (currentStatus.accessTokenValid) {
      return currentStatus.accessToken;
    } else {
      await this.refresh();
      return await this.getAccessTokenNonSynchronized();
    }
  }

  /**
   * Refresh the tokens right now, if we are logged-in.
   * If the refresh callback fails, we consider the session to be logged-out.
   */
  private async refresh(): Promise<void> {
    const currentStatus = this.getStatus();
    if (!currentStatus.loggedIn) throw LOGGED_OUT_ERROR;
    console.log("Refreshing tokens...");

    return await this.refreshCallback(
      currentStatus.refreshToken,
      this.setLoggedOut.bind(this)
    )
      .then((tokens: Tokens) => {
        const newStatus = createNewStatus(tokens);
        this.saveAndPublishStatus(newStatus);
      })
      .catch((error: { response?: object }) => {
        let resp =
          error.response != null ? ": " + JSON.stringify(error.response) : "";
        console.log(`Refresh failed ${resp}`);
        throw LOGGED_OUT_ERROR;
      });
  }

  /////////////
  // SETTERS //
  /////////////

  /**
   * Update the status of the TokenService with a new set of tokens. To be used after login.
   */
  public setStatus({
    accessToken,
    accessTokenExp,
    refreshToken,
    refreshTokenExp,
  }: Tokens): void {
    const newStatus = createNewStatus({
      accessToken,
      accessTokenExp,
      refreshToken,
      refreshTokenExp,
    });
    this.saveAndPublishStatus(newStatus);
  }

  /**
   * Update the status of the TokenService to a logged-out state.
   */
  public setLoggedOut(): void {
    this.deleteStatus();
    this.notifyStatusUpdate();
  }
}

/////////////////////////
// UTILITIES & GETTERS //
/////////////////////////

/**
 * Returns time-to-live in seconds compared to NOW.
 * Does not return a negative number.
 */
function ttl(timestamp?: number): number {
  return Math.max(
    0,
    Math.round((timestamp ?? 0) - new Date().getTime() / 1000)
  );
}

/**
 * Is the access token in the status valid right now?
 */
function accessTokenValid(status: Status): boolean {
  return (
    status.accessToken != null &&
    status.accessToken !== "" &&
    ttl(status.accessTokenExp) >= MIN_TOKEN_TTL
  );
}

/**
 * Is the refresh token in the status valid right now / are we logged-in?
 */
function refreshTokenValid(status: Status): boolean {
  return (
    status.refreshToken != null &&
    status.refreshToken !== "" &&
    ttl(status.refreshTokenExp) >= MIN_TOKEN_TTL
  );
}

/**
 * Create a new Status object from either a Tokens object or an old Status.
 */
function createNewStatus(tokensOrStatus: Tokens | Status): Status {
  let status = { ...BASE_STATUS, ...tokensOrStatus };
  status = {
    ...status,
    loggedIn: refreshTokenValid(status),
    accessTokenValid: accessTokenValid(status),
  };
  return status;
}

/////////////
// Exports //
/////////////

export default TokenService;
export type { Status };
