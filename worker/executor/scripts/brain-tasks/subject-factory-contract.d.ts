export type FactoryPackage = { version: 1; package_id: string; manifest_sha256: string; files: Array<{ name: string; bytes: number; sha256: string; url: string }> };
export const PACKAGE_ID: string;
export const KYLOGIC_TENANT: string;
export const SOURCE_HOSTS: string[];
export const FILE_NAMES: string[];
export const MAX_FILE_BYTES: number;
export const MAX_PACKAGE_BYTES: number;
export function validatePackage(raw: unknown): FactoryPackage;