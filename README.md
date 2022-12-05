# Multitab Token Refresh

When using single-use refresh tokens with multiple browser tabs,
a race condition between tabs may occur when it's time to refresh.

This little package solves this problem by using the [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) to synchronize requests for an access token, from multiple browser tabs.
If the access token needs refreshing, it is refreshed while the lock is held.
This ensures that a refresh token is only used once.

Additionally, this package can provide updates on login/logout events to peer tabs, so that they may transition to an appropriate state.

## Setup

We use Axios as an HTTP client in the example.

```javascript
// ApiService.js
import Axios from "axios";
import {
  TokenService,
  axiosAuthRequestInterceptor,
  fromJwt,
  Tokens,
} from "@weareyipyip/multitab-token-refresh";

// ApiClient will be used for requests that don't require an access token
const ApiClient = Axios.create();

// on login/refresh failure, notify the TokenService that we are logged out
function onAuthFailure(authError) {
  if (authError?.response?.status === 401) TokenService.setLoggedOut();
  // rethrow the error so that your application code can handle it
  throw authError;
}

// you need to process your own login/refresh response body format and create a new Tokens object from it
// you can use the fromJwt helper function to do so
function authResponseToTokens(resp) {
  const {
    data: { access, refresh },
  } = resp;
  const tokens = fromJwt({ accessToken: access, refreshToken: refresh });
  return tokens;
}

// define a function that can refresh tokens based on a refreshToken and returns a new Tokens object on success
function refreshTokens(refreshToken) {
  return ApiClient.post("/refresh", null, {
    headers: { authorization: `Bearer ${refreshToken}` },
  })
    .then(authResponseToTokens)
    .catch(onAuthFailure);
}

// provide that function to the TokenService so that it knows how to refresh your tokens
TokenService.setRefreshCallback(refreshTokens);

// on login, your need to notify the TokenService of the new status
function onLogin(response) {
  TokenService.setStatus(authResponseToTokens(response));
  return response;
}

// your login function
function login(username, password) {
  return ApiClient.post("/login", { username, password })
    .then(onLogin)
    .catch(onAuthFailure);
}

// AuthApiClient will be used for all requests that require an access token
const AuthApiClient = Axios.create();
AuthApiClient.interceptors.request.use(axiosAuthRequestInterceptor);

// on logout, notify the TokenService (regardless of success)
function logout() {
  return AuthApiClient.post("/logout")
    .then(TokenService.setLoggedOut)
    .catch(TokenService.setLoggedOut);
}

// now you're good to go
AuthApiClient.get("/very_secure_endpoint");
```

## Reload peer tabs on login/logout

If you want all browser tabs of your application to reflect logged-in or logged-out status,
you can force a reload of peer tabs using `subscribeToPeerTabUpdates`.
This opt-in behavior can be enabled by simply calling this function anywhere during initialization,
for example after setting the refresh callback:

```javascript
TokenService.setRefreshCallback(refreshTokens);
subscribeToPeerTabUpdates();
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
