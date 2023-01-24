"use strict";
import { TokenService, Status } from "./token-service";

/**
 * Vuex plugin to get TokenService status updates.
 * Your Vuex store must define a mutation to receive the update,
 * you can specify the mutation name when creating the store plugin.
 */
function createVuexPlugin(
  tokenService: TokenService,
  statusUpdateMutationName: string
) {
  return (store: any) => {
    tokenService.subscribeStatusUpdates((status: Status) =>
      store.commit(statusUpdateMutationName, { ...status })
    );
  };
}

export default createVuexPlugin;
