import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CenterAccessTokenPayload } from '../../shared/interfaces/token-payload.interface';
import { PrismaService } from '../../shared/services/prisma.service';
import { CenterProfileResponseDto } from './dto/center-profile.dto';
import type { UpdateCenterProfileDto } from './dto/center-profile.dto';

type SignedCenterIdentity = Pick<
  CenterAccessTokenPayload,
  'centerUserId' | 'centerId'
>;

@Injectable()
export class CenterProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(
    identity: SignedCenterIdentity,
  ): Promise<CenterProfileResponseDto> {
    return this.toProfile(await this.loadOwnedUser(identity));
  }

  async updateProfile(
    identity: SignedCenterIdentity,
    changes: UpdateCenterProfileDto,
  ): Promise<CenterProfileResponseDto> {
    const userData = this.toCenterUserData(changes);
    const centerData = this.toCenterData(changes);

    if (
      Object.keys(userData).length === 0 &&
      Object.keys(centerData).length === 0
    ) {
      throw new BadRequestException('NO_PROFILE_FIELDS_SUPPLIED');
    }

    // Prove ownership before writing. Both identifiers come from the signed
    // token, so a caller cannot reach another center's row even by guessing.
    await this.loadOwnedUser(identity);

    // PrismaPromise, not Promise: $transaction([...]) only accepts the
    // lazy query objects Prisma returns, which is what makes the batch atomic.
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (Object.keys(userData).length > 0) {
      writes.push(
        this.prisma.centerUser.update({
          where: { id: identity.centerUserId },
          data: userData,
        }),
      );
    }
    if (Object.keys(centerData).length > 0) {
      writes.push(
        this.prisma.center.update({
          where: { id: identity.centerId },
          data: centerData,
        }),
      );
    }
    await this.prisma.$transaction(writes);

    return this.toProfile(await this.loadOwnedUser(identity));
  }

  /**
   * Scoped by center_user id *and* center id. Either alone would be enough to
   * find the row; together they mean a token cannot address a user outside the
   * center it was issued for, even if the two ever drift apart.
   */
  private async loadOwnedUser(identity: SignedCenterIdentity) {
    const centerUser = await this.prisma.centerUser.findFirst({
      where: { id: identity.centerUserId, center_id: identity.centerId },
      include: { center: true },
    });

    if (!centerUser) {
      throw new NotFoundException('CENTER_PROFILE_NOT_FOUND');
    }

    return centerUser;
  }

  private toCenterUserData(changes: UpdateCenterProfileDto) {
    return {
      ...(changes.firstName !== undefined && { first_name: changes.firstName }),
      ...(changes.lastName !== undefined && { last_name: changes.lastName }),
      ...(changes.phone !== undefined && { phone: changes.phone }),
    };
  }

  private toCenterData(changes: UpdateCenterProfileDto) {
    return {
      ...(changes.centerName !== undefined && { name: changes.centerName }),
      ...(changes.country !== undefined && { country: changes.country }),
      ...(changes.city !== undefined && { city: changes.city }),
      ...(changes.logoUrl !== undefined && { logo_url: changes.logoUrl }),
    };
  }

  /**
   * Built field by field rather than by spreading the row, so a column added
   * to the schema later cannot leak into an API response by default.
   */
  private toProfile(centerUser: {
    id: string;
    role: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    email_verified: boolean;
    center: {
      id: string;
      name: string;
      country: string;
      city: string;
      logo_url: string | null;
    };
  }): CenterProfileResponseDto {
    return {
      centerUser: {
        id: centerUser.id,
        role: centerUser.role as CenterProfileResponseDto['centerUser']['role'],
        firstName: centerUser.first_name,
        lastName: centerUser.last_name,
        email: centerUser.email,
        phone: centerUser.phone,
        emailVerified: centerUser.email_verified,
      },
      center: {
        id: centerUser.center.id,
        name: centerUser.center.name,
        country: centerUser.center.country,
        city: centerUser.center.city,
        logoUrl: centerUser.center.logo_url,
      },
    };
  }
}
