import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getCurrentUser, ApiError, type CurrentUser } from './api';

/**
 * Confirms the signed-in user is authorised for this portal.
 *
 * Calls /api/me, which applies the tenant/domain policy in
 * api/shared/auth.py and returns 403 for outsiders. This is a *UX*
 * read of a decision the server has already made — the server does not
 * trust this hook, and neither should any future code.
 */
export function useAuthorisation(enabled: boolean): UseQueryResult<CurrentUser> {
  return useQuery({
    queryKey: ['api', 'me'],
    queryFn: getCurrentUser,
    enabled,
    staleTime: Infinity,
    // A 403 is a settled answer, not a transient fault. Retrying it just
    // delays the access-denied screen.
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status === 403 ? false : failureCount < 1
  });
}
