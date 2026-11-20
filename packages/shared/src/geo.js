const radians = (degrees) => (degrees * Math.PI) / 180;

export function haversineMeters(from, to) {
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, a)));
}
