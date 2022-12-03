"use strict";
import storage from "./storage";
import { Tokens } from "./tokens";

///////////
// Types //
///////////

type RefreshCallback = (refreshToken: string) => Promise<Tokens>;
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

let refreshCallbackPromiseResolver: (refreshCallback: RefreshCallback) => void;
const refreshCallbackPromise: Promise<RefreshCallback> = new Promise(function (
  resolve,
  _reject
) {
  refreshCallbackPromiseResolver = resolve;
});
const statusSubscribers: Subscriber[] = [];

////////////
// Status //
////////////

/**
 * Get the current status from LocalStorage, deserialized and with updated `loggedIn` and `accessTokenValid` fields.
 */
function getStatus(): Status {
  let serializedStatus = storage.getItem(LOCAL_STORAGE_STATUS_KEY);
  serializedStatus = serializedStatus == null ? "{}" : serializedStatus;
  const status = createNewStatus(JSON.parse(serializedStatus));
  return status;
}

/**
 * Save a status to LocalStorage.
 */
function saveStatus(status: Status): void {
  storage.setItem(LOCAL_STORAGE_STATUS_KEY, JSON.stringify(status));
  console.log("New auth status stored.");
}

/**
 * Delete the current status in LocalStorage
 */
function deleteStatus(): void {
  storage.removeItem(LOCAL_STORAGE_STATUS_KEY);
}

/**
 * Save a status to LocalStorage and notify subscribers of the new status.
 */
function saveAndPublishStatus(status: Status): void {
  saveStatus(status);
  notifyStatusUpdate();
}

//////////////
// "PubSub" //
//////////////

/**
 * Register a subscriber to receive status updates.
 */
function subscribeStatusUpdates(subscriber: Subscriber): void {
  statusSubscribers.push(subscriber);
  sendCurrentStatus(subscriber);
}

/**
 * Send the current status to a single subscriber
 */
function sendCurrentStatus(subscriber: Subscriber, status?: Status): void {
  status = status ?? getStatus();
  subscriber(status);
}

/**
 * Notify registered subscribers of status updates.
 */
function notifyStatusUpdate(): void {
  const status = getStatus();
  statusSubscribers.forEach((sub) => sendCurrentStatus(sub, status));
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

////////////////////////////
// The actual token stuff //
////////////////////////////

/**
 * Returns a promise that will resolve to the access token.
 * Refreshes the tokens if necessary.
 * Access is synchronized across tabs.
 */
async function getAccessToken(): Promise<string> {
  return navigator.locks.request(GET_TOKEN_LOCK, getAccessTokenNonSynchronized);
}

/**
 * Get an access token in a promise, if we are logged-in.
 */
async function getAccessTokenNonSynchronized(): Promise<string> {
  const currentStatus = getStatus();
  if (currentStatus.accessTokenValid) {
    return currentStatus.accessToken;
  } else {
    await refresh();
    return await getAccessTokenNonSynchronized();
  }
}

/**
 * Refresh the tokens right now, if we are logged-in.
 */
async function refresh(): Promise<void> {
  const currentStatus = getStatus();
  if (!currentStatus.loggedIn) throw LOGGED_OUT_ERROR;
  console.log("Refreshing tokens...");
  const refreshCallback = await refreshCallbackPromise;

  return await refreshCallback(currentStatus.refreshToken)
    .then((tokens: Tokens) => {
      const newStatus = createNewStatus(tokens);
      saveAndPublishStatus(newStatus);
    })
    .catch((error: { response?: object }) => {
      console.log(
        `Refresh failed ${
          error.response != null ? ": " + JSON.stringify(error.response) : ""
        }`
      );
      throw LOGGED_OUT_ERROR;
    });
}

/////////////
// SETTERS //
/////////////

/**
 * Set the httpRefresh callback, a function that will be called with the refresh token
 * when the access token has almost expired.
 */
function setRefreshCallback(refreshCallback: RefreshCallback): void {
  refreshCallbackPromiseResolver(refreshCallback);
}

/**
 * Update the status of the TokenService with a new set of tokens. To be used after login.
 */
function setStatus({
  accessToken,
  accessTokenExp,
  refreshToken,
  refreshTokenExp,
}: Tokens): void {
  saveAndPublishStatus(
    createNewStatus({
      accessToken,
      accessTokenExp,
      refreshToken,
      refreshTokenExp,
    })
  );
}

/**
 * Update the status of the TokenService to a logged-out state.
 */
function setLoggedOut(): void {
  deleteStatus();
  notifyStatusUpdate();
}

/////////////
// Exports //
/////////////

export default {
  getAccessToken,
  setStatus,
  setRefreshCallback,
  setLoggedOut,
  subscribeStatusUpdates,
  getStatus,
};
export type { Status };
