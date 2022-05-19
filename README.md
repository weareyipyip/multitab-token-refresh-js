# Multitab Token Refresh

When using single-use refresh tokens with multiple browser tabs,
a race condition between tabs may occur when it's time to refresh.

This little service solves this problem by having one "leader" tab that
is responsible for renewing the tokens when it's time to do so,
and distributing the new tokens to its peers.

Additionally, it can provide updates about login status to Redux or Vuex, for example.

## Setup

We use Axios as an HTTP client in the example.

```javascript
// ApiService.js
import Axios from "axios";
import { TokenService } from "@weareyipyip/multitab-token-refresh";

// ApiClient will be used for requests that don't require an access token
const ApiClient = Axios.create();

// you need to process your own login/refresh responses and notify the TokenService about the new tokens
function onAuthSuccess(authResponse) {
  let { accessToken, refreshToken } = authResponse.data;
  let accessPayload = parseJWT(accessToken);
  let refreshPayload = parseJWT(refreshToken);

  TokenService.updateStatus({
    accessToken,
    refreshToken,
    accessTokenExp: accessPayload.exp,
    refreshTokenExp: refreshPayload.exp,
  });

  // return the original response so that your application code can use it
  return authResponse;
}

// on login/refresh failure, notify the TokenService that we are logged out
function onAuthFailure(authError) {
  if (authError?.response?.status === 401) TokenService.setLoggedOut();
  // rethrow the error so that your application code can handle it
  throw authError;
}

// your login function
function login(username, password) {
  return ApiClient.post("/login", { username, password })
    .then(onAuthSuccess)
    .catch(onAuthFailure);
}

// you must provide a refresh callback to the TokenService so that it knows how to refresh your tokens
TokenService.setRefreshCallback((refreshToken) => {
  return ApiClient.post("/refresh", null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  })
    .then(onAuthSuccess)
    .catch(onAuthFailure);
});

// AuthApiClient will be used for all requests that require an access token
const AuthApiClient = Axios.create();

// request interceptor for authentication
AuthApiClient.interceptors.request.use(async (config) => {
  const token = await TokenService.getAccessToken();
  config.headers.authorization = `Bearer ${token}`;
  return config;
});

// now you're good to go
AuthApiClient.get("/very_secure_endpoint");
```

## Integrate with Vuex

Example for Vue/Vuex 2, but works for Vue/Vuex 3 as well. Will work across tabs.

```javascript
// store.js
import Vue from "vue";
import Vuex from "vuex";
import { createVuexPlugin } from "@weareyipyip/multitab-token-refresh";

Vue.use(Vuex);

export default new Vuex.Store({
  plugins: [createVuexPlugin("updateAuthStatus")],

  state: {
    loggedIn: false,
  },

  mutations: {
    updateAuthStatus: (state, { loggedIn }) => {
      state.loggedIn = loggedIn;
    },
  },
});
```
