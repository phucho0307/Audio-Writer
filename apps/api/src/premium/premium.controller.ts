import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { COSTLY_TIER } from '../throttler/tiers';
import { PremiumService, type SepayTransfer } from './premium.service';
import { sepayAuthentic } from './sepay-signature';

class ActivateDto {
  /** An unmatched transfer to attach to the order, if there is one. */
  @IsOptional()
  @IsUUID()
  transferId?: string;
}

@Controller()
export class PremiumController {
  private readonly secret: string;
  private readonly apiKey: string;

  constructor(
    private readonly premium: PremiumService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('SEPAY_WEBHOOK_SECRET', '');
    this.apiKey = config.get<string>('SEPAY_API_KEY', '');
  }

  @Get('premium')
  status() {
    return this.premium.status();
  }

  @Post('premium/orders')
  @Throttle(COSTLY_TIER)
  create() {
    return this.premium.createOrder();
  }

  @Get('premium/orders/:code')
  order(@Param('code') code: string) {
    return this.premium.order(code.toUpperCase());
  }

  /**
   * SePay's webhook. Answers `{ success: true }` for everything it accepted,
   * including transfers that are not for us, or SePay keeps retrying them.
   */
  @Post('payments/sepay')
  @HttpCode(200)
  @SkipThrottle()
  async sepay(@Req() req: RawBodyRequest<Request>, @Body() body: Record<string, unknown>) {
    if (!sepayAuthentic({ secret: this.secret, apiKey: this.apiKey, rawBody: req.rawBody, headers: req.headers })) {
      throw new UnauthorizedException({ success: false, message: 'Unauthorized' });
    }
    const result = await this.premium.receive(body as unknown as SepayTransfer);
    return { success: true, result };
  }

  @Get('admin/payments')
  adminList() {
    return this.premium.adminList();
  }

  @Post('admin/premium/:code/activate')
  activate(@Param('code') code: string, @Body() dto: ActivateDto) {
    return this.premium.adminActivate(code.toUpperCase(), dto.transferId);
  }
}
