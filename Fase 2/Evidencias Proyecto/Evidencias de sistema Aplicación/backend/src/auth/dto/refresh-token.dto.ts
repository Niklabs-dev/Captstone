import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token opaco emitido en el login o en la rotación anterior.',
    example: 'dGhpcy1lcy11bi1yZWZyZXNoLXRva2VuLWRlLWVqZW1wbG8',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
