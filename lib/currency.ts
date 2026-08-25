const CURRENCY_BY_COUNTRY: Record<string, string> = {
  GB: 'GBP',
  FR: 'EUR',
  SG: 'SGD',
};

export function currencyForCountry(countryCode: string): string {
  return CURRENCY_BY_COUNTRY[countryCode] ?? countryCode;
}
