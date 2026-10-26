import { PickType } from '@nestjs/swagger';
import { CreateTipEntryDto } from './create-tip-entry.dto.js';

export class UpdateTipEntryDto extends PickType(CreateTipEntryDto, [
  'amount',
] as const) {}
