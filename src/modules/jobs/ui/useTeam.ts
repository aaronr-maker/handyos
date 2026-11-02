import { listTeamMembers, useAsync } from '@/core';

/** The company's people, with a lookup for showing names. */
export function useTeam() {
  const { data, reload } = useAsync(() => listTeamMembers(), []);
  const members = data ?? [];
  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m ? m.full_name || m.email || 'Team member' : 'Team member';
  };
  return { members, nameOf, reload };
}
