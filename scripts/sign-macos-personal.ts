import { sign as signApplication, type SignOptions } from "@electron/osx-sign";

export default async function sign(options: SignOptions): Promise<void> {
  const keychain = process.env.T3CODE_MACOS_SELF_SIGNED_KEYCHAIN;
  if (!keychain) throw new Error("T3CODE_MACOS_SELF_SIGNED_KEYCHAIN is required.");
  await signApplication({
    ...options,
    keychain,
    batchCodesignCalls: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (file, fileOptions) => ({
      ...options.optionsForFile?.(file, fileOptions),
      timestamp: "none",
    }),
  });
}
