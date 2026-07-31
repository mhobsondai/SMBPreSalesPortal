import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchCurrentUser, type ClientPrincipal } from './auth';
import { nameFromUpn } from './displayName';

export interface SessionUser {
  userId: string;
  upn: string;
  displayName: string;
  roles: string[];
}

/**
 * The signed-in user for the current session.
 *
 * Sourced from the SWA principal (/.auth/me) — the security answer to
 * "is this person signed in?". Cached for the lifetime of the app.
 *
 * When the API grows a profile store, add a second hook backed by
 * /api/me for the *data* identity. Keep the two distinct: one answers a
 * security question, the other a data question.
 */
export function useCurrentUser(): UseQueryResult<SessionUser | null> {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const principal: ClientPrincipal | null = await fetchCurrentUser();
      if (!principal) return null;

      return {
        userId: principal.userId,
        upn: principal.userDetails,
        displayName: nameFromUpn(principal.userDetails),
        roles: principal.userRoles
      } satisfies SessionUser;
    },
    staleTime: Infinity,
    retry: false
  });
}
