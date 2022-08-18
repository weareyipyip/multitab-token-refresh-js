"use strict";
import { BroadcastChannel, createLeaderElection } from "broadcast-channel";
import storage from "./storage";
import { Tokens } from "./tokens";

type refreshCallback = (refreshToken: string) => Promise<any>;
type status = {
  accessToken: string;
  accessTokenExp: number;
  refreshToken: string;
  refreshTokenExp: number;
  loggedIn: boolean;
};
type subscriber = (status: status) => void;

const MSG_STATUS_CHANGE = "statusChange";
const MSG_LOGOUT = "loggedOut";
const LOCAL_STORAGE_STATUS_KEY = "authStatus";
const LOGGED_OUT_ERROR = Error("Logged out");
const BASE_STATUS: status = {
  accessToken: "",
  accessTokenExp: 0,
  refreshToken: "",
  refreshTokenExp: 0,
  loggedIn: false,
};
const REFRESH_TRESHOLD_TTL = 10;
const MIN_TTL = 5;

const authChannel = new BroadcastChannel("auth-channel", {
  webWorkerSupport: false,
});
const elector = createLeaderElection(authChannel);
let accessTokenPromiseResolver: (accessToken: string) => void;
let accessTokenPromiseRejecter: (error: Error) => void;
let accessTokenPromise: Promise<string>;
let refreshInterval: NodeJS.Timer | undefined;
let currentStatus: status = BASE_STATUS;
let currentStatusJSON: string = JSON.stringify(BASE_STATUS);
let refreshCallbackPromiseResolver: (refreshCallback: refreshCallback) => void;
let refreshCallbackPromise: Promise<refreshCallback> = new Promise(function (
  resolve,
  _reject
) {
  refreshCallbackPromiseResolver = resolve;
});
const statusSubscribers: Array<subscriber> = [];

////////////////////
// Initialization //
////////////////////

renewaccessTokenPromise();

// set the initial local status
const storedStatus = storage.getItem(LOCAL_STORAGE_STATUS_KEY) || "{}";
updateLocalStatus(JSON.parse(storedStatus) || currentStatus);

// register message handler
authChannel.onmessage = (msg) => {
  if (msg.startsWith(MSG_STATUS_CHANGE)) {
    handleStatusChangeMessage(msg);
  } else if (msg === MSG_LOGOUT) {
    handleLogoutMessage();
  }
};

// Schedule token refreshes if leader
elector.awaitLeadership().then(() => {
  console.log("This tab is now the leader and will handle token refreshing.");
  scheduleRefreshIfLeader();
});

//////////////
// "PubSub" //
//////////////

/**
 * Register a subscriber to receive status updates.
 */
function subscribeStatusUpdates(subscriber: subscriber) {
  statusSubscribers.push(subscriber);
  sendCurrentStatus(subscriber);
}

/**
 * Send the current status to a single subscriber
 */
function sendCurrentStatus(subscriber: subscriber) {
  subscriber(currentStatus);
}

/**
 * Notify registered subscribers of status updates.
 */
function notifyStatusUpdate() {
  statusSubscribers.forEach(sendCurrentStatus);
}

////////////////////////////
// STATUS CHANGE HANDLERS //
////////////////////////////

/**
 * Update the local status and notify subscribers.
 * Determines loggedIn status, creates a new status and stores it in LocalStorage.
 */
function updateLocalStatus(newTokens: Tokens) {
  let { refreshToken, refreshTokenExp, accessToken, accessTokenExp } =
    newTokens;
  const loggedIn = !!(refreshToken && ttl(refreshTokenExp) >= MIN_TTL);
  const accessValid = !!(accessToken && ttl(accessTokenExp) >= MIN_TTL);
  if (!accessValid) accessToken = "";
  let newStatus = { ...BASE_STATUS, ...newTokens, loggedIn, accessToken };
  const newStatusJSON = JSON.stringify(newStatus);

  if (newStatusJSON !== currentStatusJSON) {
    currentStatus = newStatus;
    currentStatusJSON = newStatusJSON;
    storage.setItem(LOCAL_STORAGE_STATUS_KEY, currentStatusJSON);
    notifyStatusUpdate();
  }
}

/////////////////////////////////////
// PEER TAB STATUS CHANGE HANDLERS //
/////////////////////////////////////

/**
 * Handle a session-has-changed message from a peer tab that has logged-in / refreshed.
 * Renews local status and schedules a refresh if this is the leader tab.
 *
 * @param {string} message
 */
function handleStatusChangeMessage(message: string) {
  const [, newStatusJSON] = message.split(" : ");
  if (currentStatusJSON !== newStatusJSON) {
    console.log("Received status update from peer tab");
    const status = JSON.parse(newStatusJSON || "{}");
    updateLocalStatus(status);
    accessTokenPromiseResolver(status.accessToken);
    renewaccessTokenPromise();
    scheduleRefreshIfLeader();
  }
}

/**
 * Handle logout message from a peer tab.
 * Cleans up local state and cancels scheduled refreshes.
 */
function handleLogoutMessage() {
  console.log("Received logout message from peer tab, logging out.");
  clearInterval(refreshInterval);
  storage.removeItem(LOCAL_STORAGE_STATUS_KEY);
  updateLocalStatus(BASE_STATUS);
  accessTokenPromiseRejecter(LOGGED_OUT_ERROR);
  renewaccessTokenPromise();
}

////////////////////////
// REFRESH SCHEDULING //
////////////////////////

/**
 * Schedule a token refresh if this tab is the leader and currentStatus.loggedIn = true.
 * The refresh is scheduled a few seconds before the access token expires.
 */
function scheduleRefreshIfLeader() {
  if (elector.isLeader && currentStatus.loggedIn) {
    const accessTTL = Math.max(
      0,
      ttl(currentStatus?.accessTokenExp) - REFRESH_TRESHOLD_TTL
    );
    console.log(`Refresh scheduled in ${accessTTL} seconds`);
    clearInterval(refreshInterval);
    refreshInterval = setInterval(refreshWhenExpired, 1000);
  }
}

function refreshWhenExpired() {
  const accessTTL = ttl(currentStatus?.accessTokenExp);
  if (accessTTL <= REFRESH_TRESHOLD_TTL) {
    console.log("Refreshing session / tokens...");
    return refreshCallbackPromise.then((refreshCallback) => {
      refreshCallback(currentStatus.refreshToken || "").catch((error) => {
        console.log(
          `Refresh failed ${
            error.response ? ": " + JSON.stringify(error.response) : ""
          }`
        );
        throw error;
      });
    });
  }
}

/////////////////////////
// UTILITIES & GETTERS //
/////////////////////////

/**
 * Returns time-to-live in seconds compared to NOW.
 * Does not return a negative number.
 */
function ttl(timestamp: number) {
  return Math.max(
    0,
    Math.round((timestamp || 0) - new Date().getTime() / 1000)
  );
}

/**
 * Returns a promise that will resolve to the access token.
 */
async function getAccessToken() {
  if (ttl(currentStatus?.accessTokenExp) >= MIN_TTL)
    return currentStatus.accessToken;
  else return accessTokenPromise;
}

/////////////
// SETTERS //
/////////////

/**
 * Set the httpRefresh callback, a function that will be called with the refresh token
 * when the access token has almost expired.
 */
function setRefreshCallback(refreshCallback: refreshCallback) {
  refreshCallbackPromiseResolver(refreshCallback);
}

/**
 * Update the local tab's status with a new set of tokens.
 * An unsuccesful session change should be handled by setLoggedOut().
 *
 * Updates local status, updates peer tab status and schedules the next refresh if tab leader.
 */
async function updateStatus(newTokens: Tokens) {
  updateLocalStatus(newTokens);
  accessTokenPromiseResolver(newTokens.accessToken);
  renewaccessTokenPromise();
  scheduleRefreshIfLeader();
  authChannel.postMessage(`${MSG_STATUS_CHANGE} : ${currentStatusJSON}`);
}

/**
 * Logout this tab, cancel scheduled refreshes and notify peer tabs.
 */
function setLoggedOut() {
  clearInterval(refreshInterval);
  storage.removeItem(LOCAL_STORAGE_STATUS_KEY);
  updateLocalStatus(BASE_STATUS);
  accessTokenPromiseRejecter(LOGGED_OUT_ERROR);
  renewaccessTokenPromise();
  authChannel.postMessage(MSG_LOGOUT);
}

function renewaccessTokenPromise() {
  accessTokenPromise = new Promise(function (resolve, reject) {
    accessTokenPromiseResolver = resolve;
    accessTokenPromiseRejecter = reject;
  });
  accessTokenPromise.catch(() => {});
}

export default {
  getAccessToken,
  updateStatus,
  setRefreshCallback,
  setLoggedOut,
  subscribeStatusUpdates,
};

export { status };
