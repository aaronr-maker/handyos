import { Popup, digits, mapsUrl, type PopupItem } from '@/core';
import { customerLabel } from '../display';
import { addressText } from '../address';
import type { Customer, Property } from '../types';

/** A customer's name that opens a small menu: call, text, open the customer. */
export function CustomerName({ customer, label }: { customer: Pick<Customer, 'id' | 'name' | 'display_name' | 'company_name' | 'display_name_source' | 'phone'>; label?: string }) {
  const phone = customer.phone ? digits(customer.phone) : '';
  const items: PopupItem[] = [
    ...(phone ? [{ label: `Call ${customer.phone}`, href: `tel:${phone}` }, { label: 'Text', href: `sms:${phone}` }] : []),
    { label: 'Open customer', to: `/customers/${customer.id}` },
  ];
  return <Popup items={items} title="Call, text or open">{label ?? customerLabel(customer)}</Popup>;
}

/** An address that opens a small menu: navigate there, or open everything we have at that address. */
export function AddressLink({ property, label }: { property: Pick<Property, 'id' | 'address_line1' | 'city' | 'state' | 'postal_code'>; label?: string }) {
  const text = addressText(property);
  return (
    <Popup
      items={[
        { label: 'Navigate', href: mapsUrl(text) },
        { label: 'Open address', to: `/addresses/${property.id}` },
      ]}
      title="Navigate or open"
    >
      {label ?? text}
    </Popup>
  );
}
