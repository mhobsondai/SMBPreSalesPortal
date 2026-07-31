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
 * The signed-in user, from the SWA principal (/.auth/me).
 *
 * Answers "is someone signed in?" only. On the Free SKU that is a much
 * weaker statement than it sounds — any Microsoft account can reach this
 * state. Whether they are *allowed* here is answered by /api/me, which
 * AuthGate calls separately.
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
