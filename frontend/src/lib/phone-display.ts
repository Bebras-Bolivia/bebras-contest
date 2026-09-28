/** Los números de Bolivia se guardan con +591; se muestran como «7123 4567». */
export function displayPhone(phone: string | null | undefined) {
  if (!phone) return "";
  const local = /^\+591(\d{8})$/.exec(phone.replace(/\s+/g, ""));
  return local ? `${local[1].slice(0, 4)} ${local[1].slice(4)}` : phone;
}
