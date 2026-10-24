import { PartialType } from '@nestjs/swagger';
import { CreateStoreDto } from './create-store.dto.js';

export class UpdateStoreDto extends PartialType(CreateStoreDto) {}
