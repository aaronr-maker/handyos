import { ModulePlaceholder } from '@/core';

export default function PaymentsScreen() {
  return (
    <ModulePlaceholder
      title="Payments"
      icon="payments"
      summary="Card, cash and check, all in one place."
      planned={[
        'Stripe card payments and pay-by-link',
        'Record cash and check on site',
        'Refunds with owner approval',
      ]}
    />
  );
}
