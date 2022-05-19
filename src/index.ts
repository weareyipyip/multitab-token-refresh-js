"use strict";
/* eslint-disable no-console */
import { BroadcastChannel, createLeaderElection } from "broadcast-channel";

type httpRefreshCallback = (refreshToken: string) => Promise<void>;
type newTokens = {
  accessToken: string;
  accessTokenExp: number;
  refreshToken: string;
  refreshTokenExp: number;
};
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

const authChannel = new BroadcastChannel("auth-channel", {
  webWorkerSupport: false,
});
const elector = createLeaderElection(authChannel);
let fallbackAccessTokenPromiseResolver: (accessToken: string) => void;
let fallbackAccessTokenPromiseRejecter: (error: Error) => void;
let fallbackAccessTokenPromise: Promise<string>;
let refreshTimer: any = null;
let currentStatus: status = BASE_STATUS;
let currentStatusJSON: string = "";
let httpRefreshCallbackPromiseResolver: (
  httpRefreshCallback: httpRefreshCallback
) => void;
let httpRefreshCallbackPromise: Promise<httpRefreshCallback> = new Promise(
  function (resolve, _reject) {
    httpRefreshCallbackPromiseResolver = resolve;
  }
);
const statusSubscribers: Array<subscriber> = [];

////////////////////
// Initialization //
////////////////////

renewInitialAccessTokenPromise();

// set the initial local status
updateStatus(
  JSON.parse(localStorage.getItem(LOCAL_STORAGE_STATUS_KEY) || "") ||
    currentStatus
);

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
function updateStatus(newTokens: newTokens) {
  let { refreshToken, refreshTokenExp, accessToken, accessTokenExp } =
    newTokens;
  const loggedIn = !!(refreshToken && ttl(refreshTokenExp) > 5);
  const accessValid = !!(accessToken && ttl(accessTokenExp) > 5);
  if (!accessValid) accessToken = "";
  let newStatus = { ...BASE_STATUS, ...newTokens, loggedIn, accessToken };
  const newStatusJSON = JSON.stringify(newStatus);

  if (newStatusJSON !== currentStatusJSON) {
    currentStatus = newStatus;
    currentStatusJSON = newStatusJSON;
    localStorage.setItem(LOCAL_STORAGE_STATUS_KEY, currentStatusJSON);
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
    const status = JSON.parse(newStatusJSON);
    updateStatus(status);
    fallbackAccessTokenPromiseResolver(status.accessToken);
    scheduleRefreshIfLeader();
  }
}

/**
 * Handle logout message from a peer tab.
 * Cleans up local state and cancels scheduled refreshes.
 */
function handleLogoutMessage() {
  console.log("Received logout message from peer tab, logging out.");
  clearTimeout(refreshTimer);
  localStorage.removeItem(LOCAL_STORAGE_STATUS_KEY);
  updateStatus(BASE_STATUS);
  fallbackAccessTokenPromiseRejecter(LOGGED_OUT_ERROR);
  renewInitialAccessTokenPromise();
}

////////////////////////
// REFRESH SCHEDULING //
////////////////////////

/**
 * Schedule a token refresh if this tab is the leader and currentStatus.loggedIn = true.
 * The refresh is scheduled 5 seconds before the access token expires.
 */
function scheduleRefreshIfLeader() {
  clearTimeout(refreshTimer);
  if (elector.isLeader && currentStatus.loggedIn) {
    const accessTTL = Math.max(0, ttl(currentStatus?.accessTokenExp) - 5);
    console.log(`Refresh scheduled in ${accessTTL} seconds`);
    refreshTimer = setTimeout(() => {
      console.log("Refreshing session / tokens...");
      httpRefreshCallbackPromise.then((httpRefreshCallback) => {
        httpRefreshCallback(currentStatus.refreshToken || "").catch((error) =>
          console.log(
            `Refresh failed ${
              error.response ? ": " + JSON.stringify(error.response) : ""
            }`
          )
        );
      });
    }, Math.floor(accessTTL * 1000));
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
  return currentStatus.accessToken || fallbackAccessTokenPromise;
}

/////////////
// SETTERS //
/////////////

/**
 * Set the httpRefresh callback, a function that will be called with the refresh token
 * when the access token has almost expired.
 */
function setHttpRefreshCallback(httpRefreshCallback: httpRefreshCallback) {
  httpRefreshCallbackPromiseResolver(httpRefreshCallback);
}

/**
 * Update the local tab's status with a new set of tokens.
 * An unsuccesful session change should be handled by setLoggedOut().
 *
 * Updates local status, updates peer tab status and schedules the next refresh if tab leader.
 */
async function setNewTokens(newTokens: newTokens) {
  updateStatus(newTokens);
  fallbackAccessTokenPromiseResolver(newTokens.accessToken);
  scheduleRefreshIfLeader();
  authChannel.postMessage(`${MSG_STATUS_CHANGE} : ${currentStatusJSON}`);
}

/**
 * Logout this tab, cancel scheduled refreshes and notify peer tabs.
 */
function setLoggedOut() {
  clearTimeout(refreshTimer);
  localStorage.removeItem(LOCAL_STORAGE_STATUS_KEY);
  updateStatus(BASE_STATUS);
  fallbackAccessTokenPromiseRejecter(LOGGED_OUT_ERROR);
  renewInitialAccessTokenPromise();
  authChannel.postMessage(MSG_LOGOUT);
}

function renewInitialAccessTokenPromise() {
  fallbackAccessTokenPromise = new Promise(function (resolve, reject) {
    fallbackAccessTokenPromiseResolver = resolve;
    fallbackAccessTokenPromiseRejecter = reject;
  });
  fallbackAccessTokenPromise.catch(() => {});
}

export default {
  getAccessToken,
  setNewTokens,
  setHttpRefreshCallback,
  setLoggedOut,
  subscribeStatusUpdates,
};
