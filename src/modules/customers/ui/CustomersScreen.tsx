import { ModulePlaceholder } from '@/core';

export default function CustomersScreen() {
  return (
    <ModulePlaceholder
      title="Customers"
      icon="customers"
      summary="Everyone you work for, and the properties you work at."
      planned={[
        'Customer list with search and properties',
        'One-time import from Housecall Pro and Jobber',
        'Contact history and notes',
      ]}
    />
  );
}
