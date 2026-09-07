import { NextRequest, NextResponse } from "next/server";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { INSTAGRAM_REEL_MAX_BYTES } from "@/lib/instagram-reel-quality";
import {
  MULTIPART_UPLOAD_MAX_PART_BYTES,
  MULTIPART_UPLOAD_PART_BYTES,
  isCompletedMultipartPartList,
  planMultipartParts,
} from "@/lib/upload-limits";
import { badRequest, serverError, unauthorized } from "@/lib/server/errors";
import { getS3, makeObjectKey, s3Bucket } from "@/lib/server/s3";

export const runtime = "nodejs";
export const maxDuration = 60;

interface UploadClaims extends JWTPayload {
  typ: "media_multipart_upload";
  ws: string;
  uid: string;
  uploadId: string;
  key: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
}

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.JWT_SECRET ?? "change_me_jwt_secret_32_chars_min",
  );
}

async function signUpload(claims: UploadClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(jwtSecret());
}

async function readUploadClaims(req: NextRequest): Promise<UploadClaims | null> {
  const token = req.headers.get("x-upload-token");
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ["HS256"] });
    if (payload.typ !== "media_multipart_upload") return null;
    return payload as unknown as UploadClaims;
  } catch {
    return null;
  }
}

function belongsToRequest(req: NextRequest, claims: UploadClaims): boolean {
  return claims.ws === req.headers.get("x-workspace-id") && claims.uid === req.headers.get("x-user-id");
}

function validOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId || !userId) return unauthorized();

    const action = req.nextUrl.searchParams.get("action");
    if (action === "start") {
      const body = (await req.json().catch(() => null)) as {
        filename?: unknown;
        content_type?: unknown;
        bytes?: unknown;
        width?: unknown;
        height?: unknown;
        duration?: unknown;
        format?: unknown;
      } | null;
      if (!body || typeof body.filename !== "string" || !body.filename.trim()) {
        return badRequest("missing_filename", "filename is required");
      }
      if (!Number.isSafeInteger(body.bytes) || (body.bytes as number) <= 0) {
        return badRequest("invalid_size", "bytes must be a positive integer");
      }
      if ((body.bytes as number) > INSTAGRAM_REEL_MAX_BYTES) {
        return badRequest("file_too_large", "video exceeds Instagram's 1GB reel limit");
      }
      if (!validOptionalNumber(body.width) || !validOptionalNumber(body.height) || !validOptionalNumber(body.duration)) {
        return badRequest("invalid_metadata", "width, height and duration must be finite numbers");
      }

      const filename = body.filename.trim();
      const contentType = typeof body.content_type === "string" && body.content_type
        ? body.content_type
        : "video/mp4";
      const { videoKey } = makeObjectKey(filename);
      const created = await getS3().send(new CreateMultipartUploadCommand({
        Bucket: s3Bucket(),
        Key: videoKey,
        ContentType: contentType,
      }));
      if (!created.UploadId) throw new Error("storage did not return a multipart upload id");

      const uploadToken = await signUpload({
        typ: "media_multipart_upload",
        ws: wsId,
        uid: userId,
        uploadId: created.UploadId,
        key: videoKey,
        filename,
        contentType,
        sizeBytes: body.bytes as number,
        width: body.width as number | undefined,
        height: body.height as number | undefined,
        duration: body.duration as number | undefined,
        format: typeof body.format === "string" ? body.format : undefined,
      });
      return NextResponse.json({ upload_token: uploadToken, part_size: MULTIPART_UPLOAD_PART_BYTES });
    }

    const claims = await readUploadClaims(req);
    if (!claims || !belongsToRequest(req, claims)) return unauthorized("Invalid or expired upload token");

    if (action === "complete") {
      const body = (await req.json().catch(() => null)) as { parts?: unknown } | null;
      if (!isCompletedMultipartPartList(body?.parts)) {
        return badRequest("invalid_parts", "parts must be a complete, ordered list");
      }
      const expectedPartCount = planMultipartParts(claims.sizeBytes).length;
      if (body.parts.length !== expectedPartCount) {
        return badRequest("incomplete_upload", `expected ${expectedPartCount} parts but received ${body.parts.length}`);
      }
      await getS3().send(new CompleteMultipartUploadCommand({
        Bucket: s3Bucket(),
        Key: claims.key,
        UploadId: claims.uploadId,
        MultipartUpload: {
          Parts: body.parts.map((part) => ({ ETag: part.etag, PartNumber: part.part_number })),
        },
      }));
      return NextResponse.json({
        key: claims.key,
        filename: claims.filename,
        width: claims.width,
        height: claims.height,
        duration: claims.duration,
        format: claims.format,
        bytes: claims.sizeBytes,
      });
    }

    if (action === "abort") {
      await getS3().send(new AbortMultipartUploadCommand({
        Bucket: s3Bucket(),
        Key: claims.key,
        UploadId: claims.uploadId,
      }));
      return new NextResponse(null, { status: 204 });
    }

    return badRequest("invalid_action", "action must be start, complete or abort");
  } catch (error) {
    console.error("[media multipart]", error);
    return serverError(`Multipart upload failed: ${(error as Error)?.message ?? "unknown error"}`);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const claims = await readUploadClaims(req);
    if (!claims || !belongsToRequest(req, claims)) return unauthorized("Invalid or expired upload token");

    const partNumber = Number(req.nextUrl.searchParams.get("part_number"));
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      return badRequest("invalid_part_number", "part_number must be between 1 and 10000");
    }
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MULTIPART_UPLOAD_MAX_PART_BYTES) {
      return badRequest("part_too_large", "upload part exceeds the 10MB limit");
    }

    const part = Buffer.from(await req.arrayBuffer());
    if (part.length === 0 || part.length > MULTIPART_UPLOAD_MAX_PART_BYTES) {
      return badRequest("invalid_part", "upload part must contain at most 10MB");
    }
    const uploaded = await getS3().send(new UploadPartCommand({
      Bucket: s3Bucket(),
      Key: claims.key,
      UploadId: claims.uploadId,
      PartNumber: partNumber,
      Body: part,
      ContentLength: part.length,
    }));
    if (!uploaded.ETag) throw new Error(`storage did not return an ETag for part ${partNumber}`);
    return NextResponse.json({ part_number: partNumber, etag: uploaded.ETag });
  } catch (error) {
    console.error("[media multipart part]", error);
    return serverError(`Multipart upload failed: ${(error as Error)?.message ?? "unknown error"}`);
  }
}
