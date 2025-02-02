const getCurveFromName = require("ffjavascript").getCurveFromName;
import {
  EthStateStorage,
  CredentialRequest,
  CircuitId,
  IIdentityWallet,
  ICredentialWallet,
  IDataStorage,
  ZeroKnowledgeProofRequest,
  AuthorizationRequestMessage,
  PROTOCOL_CONSTANTS,
  AuthHandler,
  core,
  ZKPRequestWithCredential,
  CredentialStatusType,
} from "@0xpolygonid/js-sdk";

import {
  initDataStorage,
  initIdentityWallet,
  initCredentialWallet,
  initMemoryIdentityWallet,
  initCircuitStorage,
  initProofService,
  initPackageManager
} from "./walletSetup";

import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

const rhsUrl = process.env.RHS_URL as string;
const walletKey = process.env.WALLET_KEY as string;


async function createIdentity(identityWallet: IIdentityWallet) {
  const { did, credential } = await identityWallet.createIdentity({
    method: core.DidMethod.Iden3,
    blockchain: core.Blockchain.Polygon,
    networkId: core.NetworkId.Mumbai,
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: rhsUrl,
    },
  });

  return {
    did,
    credential
  }
}

function createKYCAgeCredential(did: core.DID) {
  const credentialRequest: CredentialRequest = {
    credentialSchema:
      "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json/KYCAgeCredential-v3.json",
    type: "KYCAgeCredential",
    credentialSubject: {
      id: did.toString(),
      birthday: 19960424,
      documentType: 99,
    },
    expiration: 12345678888,
    revocationOpts: {
      type: CredentialStatusType.Iden3ReverseSparseMerkleTreeProof,
      id: rhsUrl,
    },
  };
  return credentialRequest;
}

function createKYCAgeCredentialRequest(circuitId: CircuitId, credentialRequest: CredentialRequest):ZeroKnowledgeProofRequest {

  const proofReqSig: ZeroKnowledgeProofRequest = {
    id: 1,
    circuitId: CircuitId.AtomicQuerySigV2,
    optional: false,
    query: {
      allowedIssuers: ["*"],
      type: credentialRequest.type,
      context:
        "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v3.json-ld",
      credentialSubject: {
        documentType: {
          $eq: 99,
        },
      },
    },
  };

  const proofReqMtp: ZeroKnowledgeProofRequest = {
    id: 1,
    circuitId: CircuitId.AtomicQueryMTPV2,
    optional: false,
    query: {
      allowedIssuers: ["*"],
      type: credentialRequest.type,
      context:
        "https://raw.githubusercontent.com/iden3/claim-schema-vocab/main/schemas/json-ld/kyc-v3.json-ld",
      credentialSubject: {
        birthday: {
          $lt: 20020101,
        },
      },
    },
  };

  switch(circuitId) {
    case CircuitId.AtomicQuerySigV2:
      return proofReqSig;
    case CircuitId.AtomicQueryMTPV2:
      return proofReqMtp;
    default:
      return proofReqSig;
  }
}

async function identityCreation() {
  console.log("=============== key creation ===============");

  let { identityWallet } = await initMemoryIdentityWallet();
  const { did, credential } = await createIdentity(identityWallet);

  console.log("=============== did ===============");
  console.log(did.toString());
  console.log("=============== Auth BJJ credential ===============");
  console.log(JSON.stringify(credential));
}

async function issueCredential() {
  console.log("=============== issue credential ===============");

  let { dataStorage, identityWallet } = await initMemoryIdentityWallet();

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  console.log("===============  credential ===============");
  console.log(JSON.stringify(credential));

  await dataStorage.credential.saveCredential(credential);
}

async function transitState() {
  console.log("=============== transit state ===============");

  let { dataStorage,
    credentialWallet,
    identityWallet
  } = await initMemoryIdentityWallet();

  const circuitStorage = await initCircuitStorage();
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  await dataStorage.credential.saveCredential(credential);

  console.log(
    "================= generate Iden3SparseMerkleTreeProof ======================="
  );

  const res = await identityWallet.addCredentialsToMerkleTree(
    [credential],
    issuerDID
  );

  console.log("================= push states to rhs ===================");

  await identityWallet.publishStateToRHS(issuerDID, rhsUrl);

  console.log("================= publish to blockchain ===================");

  const ethSigner = new ethers.Wallet(
    walletKey,
    (dataStorage.states as EthStateStorage).provider
  );
  const txId = await proofService.transitState(
    issuerDID,
    res.oldTreeState,
    true,
    dataStorage.states,
    ethSigner
  );
  console.log(txId);
}

async function generateProofs() {
  console.log("=============== generate proofs ===============");

  let { dataStorage, 
    credentialWallet, 
    identityWallet 
  } = await initMemoryIdentityWallet();

  const circuitStorage = await initCircuitStorage();
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  await dataStorage.credential.saveCredential(credential);

  console.log(
    "================= generate Iden3SparseMerkleTreeProof ======================="
  );

  const res = await identityWallet.addCredentialsToMerkleTree(
    [credential],
    issuerDID
  );

  console.log("================= push states to rhs ===================");

  await identityWallet.publishStateToRHS(issuerDID, rhsUrl);

  console.log("================= publish to blockchain ===================");

  const ethSigner = new ethers.Wallet(
    walletKey,
    (dataStorage.states as EthStateStorage).provider
  );
  const txId = await proofService.transitState(
    issuerDID,
    res.oldTreeState,
    true,
    dataStorage.states,
    ethSigner
  );
  console.log(txId);

  console.log(
    "================= generate credentialAtomicSigV2 ==================="
  );

  const proofReqSig: ZeroKnowledgeProofRequest = createKYCAgeCredentialRequest(
    CircuitId.AtomicQuerySigV2,
    credentialRequest
  )

  let credsToChooseForZKPReq = await credentialWallet.findByQuery(
    proofReqSig.query
  );

  const { proof, pub_signals } = await proofService.generateProof(
    proofReqSig,
    userDID,
    credsToChooseForZKPReq[0]
  );

  const sigProofOk = await proofService.verifyProof(
    { proof, pub_signals },
    CircuitId.AtomicQuerySigV2
  );
  console.log("valid: ", sigProofOk);

  console.log(
    "================= generate credentialAtomicMTPV2 ==================="
  );

  const credsWithIden3MTPProof =
    await identityWallet.generateIden3SparseMerkleTreeProof(
      issuerDID,
      res.credentials,
      txId
    );

  console.log(credsWithIden3MTPProof);
  credentialWallet.saveAll(credsWithIden3MTPProof);

  const proofReqMtp: ZeroKnowledgeProofRequest = createKYCAgeCredentialRequest(
    CircuitId.AtomicQueryMTPV2,
    credentialRequest
  )

  credsToChooseForZKPReq = await credentialWallet.findByQuery(
    proofReqMtp.query
  );
  const { proof: proofMTP } = await proofService.generateProof(
    proofReqMtp,
    userDID,
    credsToChooseForZKPReq[0]
  );
  console.log(JSON.stringify(proofMTP));
  const mtpProofOk = await proofService.verifyProof(
    { proof, pub_signals },
    CircuitId.AtomicQueryMTPV2
  );
  console.log("valid: ", mtpProofOk);
  // const curve = await getCurveFromName('bn128');
  // curve.terminate();

  let credsToChooseForZKPReq2 = await credentialWallet.findByQuery(
    proofReqSig.query
  );

  const { proof: proof2, pub_signals: pub_signals2 } =
    await proofService.generateProof(
      proofReqSig,
      userDID,
      credsToChooseForZKPReq2[0]
    );

  const sigProof2Ok = await proofService.verifyProof(
    { proof: proof2, pub_signals: pub_signals2 },
    CircuitId.AtomicQuerySigV2
  );
  console.log("valid: ", sigProof2Ok);
}

async function handleAuthRequest() {
  console.log("=============== handle auth request ===============");

  let { dataStorage,
    credentialWallet,
    identityWallet
  } = await initMemoryIdentityWallet();

  const circuitStorage = await initCircuitStorage();
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  await dataStorage.credential.saveCredential(credential);

  console.log(
    "================= generate Iden3SparseMerkleTreeProof ======================="
  );

  const res = await identityWallet.addCredentialsToMerkleTree(
    [credential],
    issuerDID
  );

  console.log("================= push states to rhs ===================");

  await identityWallet.publishStateToRHS(issuerDID, rhsUrl);

  console.log("================= publish to blockchain ===================");

  const ethSigner = new ethers.Wallet(
    walletKey,
    (dataStorage.states as EthStateStorage).provider
  );
  const txId = await proofService.transitState(
    issuerDID,
    res.oldTreeState,
    true,
    dataStorage.states,
    ethSigner
  );
  console.log(txId);

  console.log(
    "================= generate credentialAtomicSigV2 ==================="
  );

  const proofReqSig: ZeroKnowledgeProofRequest = createKYCAgeCredentialRequest(
    CircuitId.AtomicQuerySigV2,
    credentialRequest
  )

  console.log("=================  credential auth request ===================");

  var authRequest: AuthorizationRequestMessage = {
    id: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    thid: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    typ: PROTOCOL_CONSTANTS.MediaType.PlainMessage,
    from: issuerDID.toString(),
    type: PROTOCOL_CONSTANTS.PROTOCOL_MESSAGE_TYPE
      .AUTHORIZATION_REQUEST_MESSAGE_TYPE,
    body: {
      callbackUrl: "http://testcallback.com",
      message: "message to sign",
      scope: [proofReqSig],
      reason: "verify age",
    },
  };
  console.log(JSON.stringify(authRequest));

  const credsWithIden3MTPProof =
    await identityWallet.generateIden3SparseMerkleTreeProof(
      issuerDID,
      res.credentials,
      txId
    );

  console.log(credsWithIden3MTPProof);
  credentialWallet.saveAll(credsWithIden3MTPProof);

  var authRawRequest = new TextEncoder().encode(JSON.stringify(authRequest));

  // * on the user side */

  console.log("============== handle auth request ==============");
  const authV2Data = await circuitStorage.loadCircuitData(CircuitId.AuthV2);
  let pm = await initPackageManager(
    authV2Data,
    proofService.generateAuthV2Inputs.bind(proofService),
    proofService.verifyState.bind(proofService)
  );

  const authHandler = new AuthHandler(pm, proofService, credentialWallet);
  const authHandlerRequest =
    await authHandler.handleAuthorizationRequestForGenesisDID(
      userDID,
      authRawRequest
    );
  console.log(JSON.stringify(authHandlerRequest, null, 2));
}

async function handleAuthRequestWithProfiles() {
  console.log(
    "=============== handle auth request with profiles ==============="
  );

  let { dataStorage,
    credentialWallet,
    identityWallet
  } = await initMemoryIdentityWallet();

  const circuitStorage = await initCircuitStorage();
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  // credential is issued on the profile!
  const profileDID = await identityWallet.createProfile(
    userDID,
    50,
    "test verifier"
  );

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  await dataStorage.credential.saveCredential(credential);

  console.log(
    "================= generate credentialAtomicSigV2 ==================="
  );

  const proofReqSig: ZeroKnowledgeProofRequest = createKYCAgeCredentialRequest(
    CircuitId.AtomicQuerySigV2,
    credentialRequest
  )

  console.log("=================  credential auth request ===================");

  var authRequest: AuthorizationRequestMessage = {
    id: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    thid: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    typ: PROTOCOL_CONSTANTS.MediaType.PlainMessage,
    from: issuerDID.toString(),
    type: PROTOCOL_CONSTANTS.PROTOCOL_MESSAGE_TYPE
      .AUTHORIZATION_REQUEST_MESSAGE_TYPE,
    body: {
      callbackUrl: "http://testcallback.com",
      message: "message to sign",
      scope: [proofReqSig],
      reason: "verify age",
    },
  };
  console.log(JSON.stringify(authRequest));

  var authRawRequest = new TextEncoder().encode(JSON.stringify(authRequest));

  // * on the user side */

  console.log("============== handle auth request ==============");
  const authV2Data = await circuitStorage.loadCircuitData(CircuitId.AuthV2);
  let pm = await initPackageManager(
    authV2Data,
    proofService.generateAuthV2Inputs.bind(proofService),
    proofService.verifyState.bind(proofService)
  );

  const authHandler = new AuthHandler(pm, proofService, credentialWallet);

  // for the flow when profiles are used it's important to know the nonces of profiles
  // for authentication profile and profile on which credential has been issued

  const authR = await authHandler.parseAuthorizationRequest(authRawRequest);

  // let's find credential for each request (emulation that we show it in the wallet ui)

  const reqCreds: ZKPRequestWithCredential[] = [];

  for (let index = 0; index < authR.body!.scope.length; index++) {
    const zkpReq = authR.body!.scope[index];

    const credsToChooseForZKPReq = await credentialWallet.findByQuery(
      zkpReq.query
    );

    // filter credentials for subjects that are profiles of identity

    const profiles = await dataStorage.identity.getProfilesByGenesisIdentifier(
      userDID.toString()
    );

    // finds all credentials that belongs to genesis identity or profiles derived from it
    const credsThatBelongToGenesisIdOrItsProfiles =
      credsToChooseForZKPReq.filter((cred) => {
        const credentialSubjectId = cred.credentialSubject["id"] as string; // credential subject
        return (
          credentialSubjectId == userDID.toString() ||
          profiles.some((p) => {
            return p.id === credentialSubjectId;
          })
        );
      });

    // you can show user credential that can be used for request (emulation - user choice)
    const chosenCredByUser = credsThatBelongToGenesisIdOrItsProfiles[0];

    // get profile nonce that was used as a part of subject in the credential
    const credentialSubjectProfileNonce =
      chosenCredByUser.credentialSubject["id"] === userDID.toString()
        ? 0
        : profiles.find((p) => {
            return p.id === chosenCredByUser.credentialSubject["id"];
          })!.nonce;
    console.log("credential profile nonce: ", credentialSubjectProfileNonce);
    reqCreds.push({
      req: zkpReq,
      credential: chosenCredByUser,
      credentialSubjectProfileNonce,
    }); // profile nonce of credential subject
  }

  // you can create new profile here for auth or if you want to login with genesis set to 0.

  const authProfileNonce = 100;
  console.log("auth profile nonce: ", authProfileNonce);

  const resp = await authHandler.generateAuthorizationResponse(
    userDID,
    authProfileNonce, // new profile for auth
    authR,
    reqCreds
  );

  console.log(resp);
}

async function handleAuthRequestNoIssuerStateTransition() {
  console.log(
    "=============== handle auth request no issuer state transition ==============="
  );

  let { dataStorage,
    credentialWallet,
    identityWallet
  } = await initMemoryIdentityWallet();

  const circuitStorage = await initCircuitStorage();
  const proofService = await initProofService(
    identityWallet,
    credentialWallet,
    dataStorage.states,
    circuitStorage
  );

  const { did: userDID, credential: authBJJCredentialUser } =
    await createIdentity(identityWallet);

  console.log("=============== user did ===============");
  console.log(userDID.toString());

  const { did: issuerDID, credential: issuerAuthBJJCredential } =
    await createIdentity(identityWallet);

  const credentialRequest = createKYCAgeCredential(userDID);
  const credential = await identityWallet.issueCredential(
    issuerDID,
    credentialRequest
  );

  await dataStorage.credential.saveCredential(credential);

  console.log(
    "================= generate credentialAtomicSigV2 ==================="
  );

  const proofReqSig: ZeroKnowledgeProofRequest = createKYCAgeCredentialRequest(
    CircuitId.AtomicQuerySigV2,
    credentialRequest
  )

  console.log("=================  credential auth request ===================");

  var authRequest: AuthorizationRequestMessage = {
    id: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    thid: "fe6354fe-3db2-48c2-a779-e39c2dda8d90",
    typ: PROTOCOL_CONSTANTS.MediaType.PlainMessage,
    from: issuerDID.toString(),
    type: PROTOCOL_CONSTANTS.PROTOCOL_MESSAGE_TYPE
      .AUTHORIZATION_REQUEST_MESSAGE_TYPE,
    body: {
      callbackUrl: "http://testcallback.com",
      message: "message to sign",
      scope: [proofReqSig],
      reason: "verify age",
    },
  };
  console.log(JSON.stringify(authRequest));

  var authRawRequest = new TextEncoder().encode(JSON.stringify(authRequest));

  // * on the user side */

  console.log("============== handle auth request ==============");
  const authV2Data = await circuitStorage.loadCircuitData(CircuitId.AuthV2);
  let pm = await initPackageManager(
    authV2Data,
    proofService.generateAuthV2Inputs.bind(proofService),
    proofService.verifyState.bind(proofService)
  );

  const authHandler = new AuthHandler(pm, proofService, credentialWallet);
  const authHandlerRequest =
    await authHandler.handleAuthorizationRequestForGenesisDID(
      userDID,
      authRawRequest
    );
  console.log(JSON.stringify(authHandlerRequest, null, 2));
}

async function main(choice: String) {
  switch (choice) {
    case 'identityCreation':
      await identityCreation();
      break;
    case 'issueCredential':
      await issueCredential();
      break;
    case 'transitState':
      await transitState();
      break;
    case 'generateProofs':
      await generateProofs();
      break;
    case 'handleAuthRequest':
      await handleAuthRequest();
      break;
    case 'handleAuthRequestWithProfiles':
      await handleAuthRequestWithProfiles();
      break;
    case 'handleAuthRequestNoIssuerStateTransition':
      await handleAuthRequestNoIssuerStateTransition();
      break;
    default:
      // default run all
      await identityCreation();
      await issueCredential();
      await transitState();
      await generateProofs();
      await handleAuthRequest();
      await handleAuthRequestWithProfiles();
      await handleAuthRequestNoIssuerStateTransition();
  }
}

(async function () {
  const args = process.argv.slice(2);
  await main(args[0]);
})();
