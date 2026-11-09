const colors = ["#217873", "#8651a1", "#a54931", "#2c62a0", "#7c671d", "#a53f74", "#436b34"];

export function chatColor(id: number, selected: string | null) {
  return selected ?? colors[(id - 1) % colors.length];
}
