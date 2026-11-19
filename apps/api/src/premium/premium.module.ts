import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';

/** Global so quota, search and narration can ask whether a user is premium. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PremiumController],
  providers: [PremiumService],
  exports: [PremiumService],
})
export class PremiumModule {}
