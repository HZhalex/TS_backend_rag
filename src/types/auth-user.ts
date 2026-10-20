export type Role = 'user' | 'admin';

/** Identity attached to `req.user` by the JWT guards. */
export interface AuthUser {
  id: string;
  roles: Role[];
}
