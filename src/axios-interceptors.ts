"use strict";
import TokenService from "./token-service";

function createAxiosAuthRequestInterceptor(
  tokenService: TokenService
): (config: any) => Promise<{ headers: { authorization: string } }> {
  return async (config: any) => {
    const token = await tokenService.getAccessToken();
    config.headers.authorization = `Bearer ${token}`;
    return config;
  };
}

export { createAxiosAuthRequestInterceptor };
