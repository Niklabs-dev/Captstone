// Política de contraseña compartida por el alta (SPRINT-1-T08) y el
// restablecimiento por el administrador (SPRINT-3-T04).
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 32;
// bcrypt solo considera los primeros 72 bytes y trunca el resto sin avisar;
// 32 caracteres de algunos alfabetos o emojis pueden superar los 72 bytes.
export const PASSWORD_MAX_BYTES = 72;
