import { ModulePlaceholder } from '@/core';

export default function InvoicingScreen() {
  return (
    <ModulePlaceholder
      title="Invoices"
      icon="invoicing"
      summary="Get paid for the work, fast."
      planned={[
        'Invoice from a completed job in one tap',
        'Send by text or email with a pay link',
        'Automatic overdue reminders',
      ]}
    />
  );
}
