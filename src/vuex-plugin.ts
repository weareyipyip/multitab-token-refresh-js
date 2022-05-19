"use strict";
import TokenService, { status } from "./token-service";

/**
 * Vuex plugin to get TokenService status updates.
 * Your Vuex store must define a mutation to receive the update,
 * you can specify the mutation name when creating the store plugin.
 */
function createVuexPlugin(statusUpdateMutationName: string) {
  return (store: any) => {
    TokenService.subscribeStatusUpdates((status: status) => {
      store.commit(statusUpdateMutationName, { ...status });
    });
  };
}

export default createVuexPlugin;
