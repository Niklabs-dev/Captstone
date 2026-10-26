import { PickType } from '@nestjs/swagger';
import { CreateTipEntryDto } from './create-tip-entry.dto.js';

export class ListTipEntriesQueryDto extends PickType(CreateTipEntryDto, [
  'storeId',
  'businessDate',
] as const) {}
