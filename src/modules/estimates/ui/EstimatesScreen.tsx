import { ModulePlaceholder } from '@/core';

export default function EstimatesScreen() {
  return (
    <ModulePlaceholder
      title="Estimates"
      icon="estimates"
      summary="Price book and good-better-best quotes your customers can approve."
      planned={[
        'Price book of services and materials',
        'Build and send estimates from a phone',
        'Customer approval turns into a job automatically',
      ]}
    />
  );
}
