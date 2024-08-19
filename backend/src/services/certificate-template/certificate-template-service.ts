import { ForbiddenError } from "@casl/ability";
import bcrypt from "bcrypt";

import { TCertificateTemplateEstConfigsUpdate } from "@app/db/schemas";
import { TPermissionServiceFactory } from "@app/ee/services/permission/permission-service";
import { ProjectPermissionActions, ProjectPermissionSub } from "@app/ee/services/permission/project-permission";
import { getConfig } from "@app/lib/config/env";
import { BadRequestError, NotFoundError } from "@app/lib/errors";

import { TCertificateAuthorityDALFactory } from "../certificate-authority/certificate-authority-dal";
import { TKmsServiceFactory } from "../kms/kms-service";
import { TProjectDALFactory } from "../project/project-dal";
import { getProjectKmsCertificateKeyId } from "../project/project-fns";
import { TCertificateTemplateDALFactory } from "./certificate-template-dal";
import { TCertificateTemplateEstConfigDALFactory } from "./certificate-template-est-config-dal";
import {
  TCreateCertTemplateDTO,
  TCreateEstConfigurationDTO,
  TDeleteCertTemplateDTO,
  TGetCertTemplateDTO,
  TGetEstConfigurationDTO,
  TUpdateCertTemplateDTO,
  TUpdateEstConfigurationDTO
} from "./certificate-template-types";

type TCertificateTemplateServiceFactoryDep = {
  certificateTemplateDAL: TCertificateTemplateDALFactory;
  certificateTemplateEstConfigDAL: TCertificateTemplateEstConfigDALFactory;
  projectDAL: Pick<TProjectDALFactory, "findProjectBySlug" | "findOne" | "updateById" | "findById" | "transaction">;
  kmsService: Pick<TKmsServiceFactory, "generateKmsKey" | "encryptWithKmsKey" | "decryptWithKmsKey">;
  certificateAuthorityDAL: Pick<TCertificateAuthorityDALFactory, "findById">;
  permissionService: Pick<TPermissionServiceFactory, "getProjectPermission">;
};

export type TCertificateTemplateServiceFactory = ReturnType<typeof certificateTemplateServiceFactory>;

export const certificateTemplateServiceFactory = ({
  certificateTemplateDAL,
  certificateTemplateEstConfigDAL,
  certificateAuthorityDAL,
  permissionService,
  kmsService,
  projectDAL
}: TCertificateTemplateServiceFactoryDep) => {
  const createCertTemplate = async ({
    caId,
    pkiCollectionId,
    name,
    commonName,
    subjectAlternativeName,
    ttl,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TCreateCertTemplateDTO) => {
    const ca = await certificateAuthorityDAL.findById(caId);
    if (!ca) {
      throw new NotFoundError({
        message: "CA not found"
      });
    }
    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      ca.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Create,
      ProjectPermissionSub.CertificateTemplates
    );

    const { id } = await certificateTemplateDAL.create({
      caId,
      pkiCollectionId,
      name,
      commonName,
      subjectAlternativeName,
      ttl
    });

    const certificateTemplate = await certificateTemplateDAL.getById(id);
    if (!certificateTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found"
      });
    }

    return certificateTemplate;
  };

  const updateCertTemplate = async ({
    id,
    caId,
    pkiCollectionId,
    name,
    commonName,
    subjectAlternativeName,
    ttl,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TUpdateCertTemplateDTO) => {
    const certTemplate = await certificateTemplateDAL.getById(id);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      certTemplate.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      ProjectPermissionSub.CertificateTemplates
    );

    if (caId) {
      const ca = await certificateAuthorityDAL.findById(caId);
      if (!ca || ca.projectId !== certTemplate.projectId) {
        throw new BadRequestError({
          message: "Invalid CA"
        });
      }
    }

    await certificateTemplateDAL.updateById(certTemplate.id, {
      caId,
      pkiCollectionId,
      commonName,
      subjectAlternativeName,
      name,
      ttl
    });

    const updatedTemplate = await certificateTemplateDAL.getById(id);
    if (!updatedTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found"
      });
    }

    return updatedTemplate;
  };

  const deleteCertTemplate = async ({ id, actorId, actorAuthMethod, actor, actorOrgId }: TDeleteCertTemplateDTO) => {
    const certTemplate = await certificateTemplateDAL.getById(id);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      certTemplate.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Delete,
      ProjectPermissionSub.CertificateTemplates
    );

    await certificateTemplateDAL.deleteById(certTemplate.id);

    return certTemplate;
  };

  const getCertTemplate = async ({ id, actorId, actorAuthMethod, actor, actorOrgId }: TGetCertTemplateDTO) => {
    const certTemplate = await certificateTemplateDAL.getById(id);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      certTemplate.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Read,
      ProjectPermissionSub.CertificateTemplates
    );

    return certTemplate;
  };

  const createEstConfiguration = async ({
    certificateTemplateId,
    caChain,
    passphrase,
    isEnabled,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TCreateEstConfigurationDTO) => {
    const certTemplate = await certificateTemplateDAL.getById(certificateTemplateId);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      certTemplate.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      ProjectPermissionSub.CertificateTemplates
    );

    const appCfg = getConfig();

    const certificateManagerKmsId = await getProjectKmsCertificateKeyId({
      projectId: certTemplate.projectId,
      projectDAL,
      kmsService
    });

    const kmsEncryptor = await kmsService.encryptWithKmsKey({
      kmsId: certificateManagerKmsId
    });

    const { cipherTextBlob: encryptedCaChain } = await kmsEncryptor({
      plainText: Buffer.from(caChain)
    });

    const hashedPassphrase = await bcrypt.hash(passphrase, appCfg.SALT_ROUNDS);
    const estConfig = await certificateTemplateEstConfigDAL.create({
      certificateTemplateId,
      hashedPassphrase,
      encryptedCaChain,
      isEnabled
    });

    return { ...estConfig, projectId: certTemplate.projectId };
  };

  const updateEstConfiguration = async ({
    certificateTemplateId,
    caChain,
    passphrase,
    isEnabled,
    actorId,
    actorAuthMethod,
    actor,
    actorOrgId
  }: TUpdateEstConfigurationDTO) => {
    const certTemplate = await certificateTemplateDAL.getById(certificateTemplateId);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    const { permission } = await permissionService.getProjectPermission(
      actor,
      actorId,
      certTemplate.projectId,
      actorAuthMethod,
      actorOrgId
    );

    ForbiddenError.from(permission).throwUnlessCan(
      ProjectPermissionActions.Edit,
      ProjectPermissionSub.CertificateTemplates
    );

    const originalCaEstConfig = await certificateTemplateEstConfigDAL.findOne({
      certificateTemplateId
    });

    if (!originalCaEstConfig) {
      throw new NotFoundError({
        message: "EST configuration not found"
      });
    }

    const appCfg = getConfig();

    const certificateManagerKmsId = await getProjectKmsCertificateKeyId({
      projectId: certTemplate.projectId,
      projectDAL,
      kmsService
    });

    const updatedData: TCertificateTemplateEstConfigsUpdate = {
      isEnabled
    };

    if (caChain) {
      const kmsEncryptor = await kmsService.encryptWithKmsKey({
        kmsId: certificateManagerKmsId
      });

      const { cipherTextBlob: encryptedCaChain } = await kmsEncryptor({
        plainText: Buffer.from(caChain)
      });

      updatedData.encryptedCaChain = encryptedCaChain;
    }

    if (passphrase) {
      const hashedPassphrase = await bcrypt.hash(passphrase, appCfg.SALT_ROUNDS);
      updatedData.hashedPassphrase = hashedPassphrase;
    }

    const estConfig = await certificateTemplateEstConfigDAL.updateById(originalCaEstConfig.id, updatedData);

    return { ...estConfig, projectId: certTemplate.projectId };
  };

  const getEstConfiguration = async (dto: TGetEstConfigurationDTO) => {
    const { certificateTemplateId } = dto;

    const certTemplate = await certificateTemplateDAL.getById(certificateTemplateId);
    if (!certTemplate) {
      throw new NotFoundError({
        message: "Certificate template not found."
      });
    }

    if (!dto.isInternal) {
      const { permission } = await permissionService.getProjectPermission(
        dto.actor,
        dto.actorId,
        certTemplate.projectId,
        dto.actorAuthMethod,
        dto.actorOrgId
      );

      ForbiddenError.from(permission).throwUnlessCan(
        ProjectPermissionActions.Edit,
        ProjectPermissionSub.CertificateTemplates
      );
    }

    const estConfig = await certificateTemplateEstConfigDAL.findOne({
      certificateTemplateId
    });

    if (!estConfig) {
      throw new NotFoundError({
        message: "EST configuration not found"
      });
    }

    const certificateManagerKmsId = await getProjectKmsCertificateKeyId({
      projectId: certTemplate.projectId,
      projectDAL,
      kmsService
    });

    const kmsDecryptor = await kmsService.decryptWithKmsKey({
      kmsId: certificateManagerKmsId
    });

    const decryptedCaChain = await kmsDecryptor({
      cipherTextBlob: estConfig.encryptedCaChain
    });

    return {
      certificateTemplateId,
      id: estConfig.id,
      isEnabled: estConfig.isEnabled,
      caChain: decryptedCaChain.toString(),
      hashedPassphrase: estConfig.hashedPassphrase,
      projectId: certTemplate.projectId
    };
  };

  return {
    createCertTemplate,
    getCertTemplate,
    deleteCertTemplate,
    updateCertTemplate,
    createEstConfiguration,
    updateEstConfiguration,
    getEstConfiguration
  };
};
