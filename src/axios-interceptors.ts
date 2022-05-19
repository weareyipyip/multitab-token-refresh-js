"use strict";
import TokenService from "./token-service";

/**
 * Request interceptor for Axios, allowing it to make authenticated API requests.
 */
async function axiosAuthRequestInterceptor(config: any) {
  const token = await TokenService.getAccessToken();
  config.headers.authorization = `Bearer ${token}`;
  return config;
}

export { axiosAuthRequestInterceptor };
