import { ModulePlaceholder } from '@/core';

export default function SchedulingScreen() {
  return (
    <ModulePlaceholder
      title="Schedule"
      icon="scheduling"
      summary="Who is where, and when."
      planned={[
        'Day and week calendar by tech',
        'Drag to reschedule, with customer notification',
        'Route-friendly daily view for techs',
      ]}
    />
  );
}
