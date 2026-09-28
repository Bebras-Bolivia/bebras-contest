import { parsePhoneNumberFromString } from "libphonenumber-js/max";

type PhoneValidation =
  | { number: string; error?: never }
  | { number?: never; error: string };

/** Sin prefijo se interpreta Bolivia; solo se limpian separadores, nunca letras. */
export function validatePhone(value: string): PhoneValidation {
  const input = value.trim();
  if (!input) return { error: "Ingresa tu teléfono de contacto." };

  if (input.length > 100 || !/^[+0-9\s().-]+$/.test(input)) {
    return { error: "El teléfono no debe contener letras ni otros símbolos." };
  }

  const compact = input.replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]+$/.test(compact)) {
    return { error: "Usa el signo + solo al inicio del código de país." };
  }
  if (!compact.startsWith("+") && compact.length !== 8) {
    return {
      error:
        "En Bolivia el teléfono tiene 8 dígitos. Para otro país, incluye + y el código de país.",
    };
  }

  const national = compact.startsWith("+591")
    ? compact.slice(4)
    : compact.startsWith("+")
      ? null
      : compact;
  // La serie de celulares que empieza con 5 aún no figura en libphonenumber.
  if (national && /^[567][0-9]{7}$/.test(national)) {
    return { number: `+591${national}` };
  }

  const phone = parsePhoneNumberFromString(compact, {
    defaultCountry: "BO",
    extract: false,
  });
  if (!phone?.isValid()) {
    return {
      error: "Ingresa un teléfono válido con su código de país si corresponde.",
    };
  }

  return { number: phone.number };
}
