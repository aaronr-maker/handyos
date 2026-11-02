import { ModulePlaceholder } from '@/core';

export default function JobsScreen() {
  return (
    <ModulePlaceholder
      title="Jobs"
      icon="jobs"
      summary="Every job from approved estimate to finished work."
      planned={[
        'Job list and detail with photos and notes',
        'Tech clock in / clock out on the job',
        'Complete a job and trigger the invoice',
      ]}
    />
  );
}
