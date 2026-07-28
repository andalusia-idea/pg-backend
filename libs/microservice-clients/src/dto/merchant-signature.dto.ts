import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';

export enum HttpMethodEnum {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

/**
 * Shape of the 5 x-* headers a merchant sends on a signed request. Built by
 * the HTTP layer (out of scope here - "TCP connection only") and passed in
 * as-is for validation against the stored merchant secret.
 */
export interface MerchantSignatureHeaderDto {
  xClientId: string;
  xTimestamp: string;
  xNonce: string;
  xSignature: string;
  xSignAlg: string;
}

export class FindSignatureValidationDto {
  @IsObject()
  headers: MerchantSignatureHeaderDto;

  @IsEnum(HttpMethodEnum)
  @Transform(({ value }) => (value as string)?.toUpperCase())
  method: HttpMethodEnum;

  @IsString()
  path: string;

  @IsOptional()
  body: unknown;
}

export class SignatureValidationResultDto {
  isValid: boolean;
  userId: number;
  message: string;
  nmid: string | null;
  credentials: Record<string, unknown> | null;
}

export class FindMerchantUrlDto {
  @IsNumber()
  userId: number;
}

export class MerchantUrlResultDto {
  payinUrl: string | null;
  payoutUrl: string | null;
}
