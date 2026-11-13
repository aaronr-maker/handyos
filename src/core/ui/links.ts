/** Opens the maps app for an address: the phone's maps on a phone, Google Maps elsewhere. */
export const mapsUrl = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
export const digits = (phone: string) => phone.replace(/[^\d+]/g, '');
