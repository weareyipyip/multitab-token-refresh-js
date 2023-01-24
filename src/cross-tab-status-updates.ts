import { TokenService } from "./token-service";
import { BroadcastChannel } from "broadcast-channel";

const CHANNEL_NAME = "multitab-token-refresh-channel";
const MSG_STATUS_CHANGE = "statusChange";
const authChannel = new BroadcastChannel(CHANNEL_NAME);

function handleStatusChangeMessage(message: string): void {
  const [, loggedIn] = message.split(": ");
  console.log(
    `Peer tab indicates ${loggedIn === "true" ? "logged-in" : "logged-out"}`
  );
  location.reload();
}

/**
 * Subscribe to peer tab status updates about login/logout status.
 * On a peer tab login/logout, the page fully reloads.
 */
function subscribeToPeerTabUpdates(tokenService: TokenService): void {
  let loggedIn = tokenService.getStatus().loggedIn;

  tokenService.subscribeStatusUpdates((status) => {
    const oldLoggedIn = loggedIn;
    loggedIn = status.loggedIn;
    if (loggedIn !== oldLoggedIn) {
      void authChannel.postMessage(
        `${MSG_STATUS_CHANGE}: ${loggedIn ? "true" : "false"}`
      );
    }
  });

  authChannel.onmessage = (message: string) => {
    if (message.startsWith(MSG_STATUS_CHANGE))
      handleStatusChangeMessage(message);
  };
}

export { subscribeToPeerTabUpdates };
