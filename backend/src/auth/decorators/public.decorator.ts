import { SetMetadata, type CustomDecorator } from '@nestjs/common';

// Marca un endpoint como público: el JwtAuthGuard global lo deja pasar sin token.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator<string> =>
  SetMetadata(IS_PUBLIC_KEY, true);
