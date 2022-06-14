import { parseExp } from "./jwt";

export interface Tokens {
  accessToken: string;
  accessTokenExp: number;
  refreshToken: string;
  refreshTokenExp: number;
}

export function fromJwt(accessToken: string, refreshToken: string): Tokens {
  return { accessToken, accessTokenExp: parseExp(accessToken), refreshToken, refreshTokenExp: parseExp(refreshToken) };
}
