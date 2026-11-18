export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthHousehold {
  id: string;
  name: string;
  baseCurrencyCode: string;
  role: string;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  hid: string;
  tokenType: 'access';
}

export interface AuthContext {
  sessionId: string;
  user: AuthUser;
  household: AuthHousehold;
}

export interface LoginBody {
  email: string;
  password: string;
  householdId?: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
  household: AuthHousehold;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  is_active: boolean;
}

export interface HouseholdRow {
  household_id: string;
  household_name: string;
  base_currency_code: string;
  role: string;
}

export interface SessionMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface RefreshRow {
  refresh_token_id: string;
  session_id: string;
  token_expires_at: Date;
  token_used_at: Date | null;
  token_revoked_at: Date | null;
  user_id: string;
  household_id: string;
  session_expires_at: Date;
  session_revoked_at: Date | null;
  email: string;
  display_name: string;
  is_active: boolean;
  household_name: string;
  base_currency_code: string;
  role: string;
}

export interface SessionResult {
  refreshToken: string;
  accessToken: string;
  authResponse: AuthResponse;
}

export interface AuthenticatedSessionRow {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  household_id: string;
  household_name: string;
  base_currency_code: string;
  role: string;
}

export interface CreatedIdRow {
  id: string;
}
