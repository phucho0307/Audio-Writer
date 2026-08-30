import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AuthorType, Visibility, StoryStatus } from '@prisma/client';

export class CreateStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  /**
   * Optional on purpose. A writer who just wants to start typing should not be
   * made to categorise their story first - genres are an input the AI needs,
   * not a property of the story. They are required only when asking for AI
   * help or publishing.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsIn(['vi', 'en'])
  language?: 'vi' | 'en';
}

export class UpdateStoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  synopsis?: string;

  /** Chapters that stay readable by everyone, forever. Minimum 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  freeChapters?: number;

  /** Credits to unlock the rest. 0 leaves the story fully open. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  unlockPrice?: number;

  /** Publishing. PRIVATE is owner-only; UNLISTED is by-link but unlisted. */
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  /** DRAFTING while it is being written, COMPLETE when the writer says so. */
  @IsOptional()
  @IsEnum(StoryStatus)
  status?: StoryStatus;

  /** Whether other people may fork this story. */
  @IsOptional()
  @IsBoolean()
  allowForks?: boolean;
}

export class CommitContributionDto {
  /** TipTap/ProseMirror document for this chunk only. */
  @IsObject()
  content!: Record<string, unknown>;

  @IsString()
  @MinLength(1)
  textPlain!: string;

  @IsEnum(AuthorType)
  authorType!: AuthorType;

  @IsOptional()
  @IsString()
  modelProvider?: string;

  @IsOptional()
  @IsString()
  modelName?: string;
}

export class ForkBranchDto {
  /** Everything at or below this depth is inherited from the parent branch. */
  @IsInt()
  @Min(0)
  atDepth!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;
}

export class GrantCreditsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  amount?: number;
}

/** Both optional: renaming a chapter and rewriting it are separate acts. */
export class EditContributionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  textPlain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
