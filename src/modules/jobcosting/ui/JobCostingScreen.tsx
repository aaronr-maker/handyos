import { ModulePlaceholder } from '@/core';

export default function JobCostingScreen() {
  return (
    <ModulePlaceholder
      title="Job costing"
      icon="jobcosting"
      summary="Know what every job really earned."
      planned={[
        'Labor, materials and overhead per job',
        'Profit and margin by job and by tech',
        'Pay-for-performance (P4P) distributions',
      ]}
    />
  );
}
