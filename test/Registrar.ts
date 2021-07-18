import { ethers } from "hardhat";
import { BigNumber, Contract, Signer } from "ethers";
import { expect } from "chai";

const FIRST_ID = 1;
const TWENTY_FOUR_HOURS = 24 * 60 * 60;

describe("Registrar contract", function () {
  let accounts: Signer[];

  let account_1: Signer;
  let account_2: Signer;
  let account_3: Signer;
  let account_4: Signer;

  let registrar: Contract;

  beforeEach(async () => {
    accounts = await ethers.getSigners();
    [account_1, account_2, account_3, account_4] = accounts;
    const Registrar = await ethers.getContractFactory("Registrar");
    registrar = await Registrar.deploy();
    await registrar.deployed();
  });

  it("Person is registered", async function () {
    const [firstName, lastName, birthdate] = ["Super", "Doge", 946702800]; // 2000-01-01
    const tx = await (
      await registrar
        .connect(account_1)
        .register(firstName, lastName, birthdate)
    ).wait();
    const event = tx?.events[0];

    // check that PersonRegistered event was emitted
    expect(event?.event).to.equal("PersonRegistered");
    expect(event?.args?.id).to.equal(BigNumber.from(FIRST_ID));

    // check that the registered data matches the inputs
    expect(
      await registrar.connect(account_1).viewPerson(FIRST_ID)
    ).to.deep.equal([firstName, lastName, BigNumber.from(birthdate)]);

    // cannot register user twice
    await expect(
      registrar.connect(account_1).register(firstName, lastName, birthdate)
    ).to.be.revertedWith("User already exists.");
  });

  it("Unauthorized person cannot view", async function () {
    await registrar.connect(account_1).register("a", "b", 1);
    await expect(
      registrar.connect(account_2).viewPerson(FIRST_ID)
    ).to.be.revertedWith("Address is not authorized to view this user ID.");
  });

  it("Authorized person can view", async function () {
    const [firstName, lastName, birthdate] = ["a", "b", 1];
    await registrar.connect(account_1).register(firstName, lastName, birthdate);
    const tx = await (
      await registrar
        .connect(account_1)
        .addAuthorizedViewer(account_2.getAddress())
    ).wait();
    const event = tx?.events[0];

    // check that ViewerAuthorized event was emitted
    expect(event?.event).to.equal("ViewerAuthorized");
    expect(event?.args?.id).to.equal(BigNumber.from(FIRST_ID));
    expect(event?.args?.viewer).to.equal(await account_2.getAddress());

    // check that the authorized person can view
    expect(
      await registrar.connect(account_2).viewPerson(FIRST_ID)
    ).to.deep.equal([firstName, lastName, BigNumber.from(birthdate)]);
  });

  it("Cannot call methods that require user to exist", async function () {
    // cannot authorize viewer for user that does not exist
    await expect(
      registrar.connect(account_1).addAuthorizedViewer(account_2.getAddress())
    ).to.be.revertedWith("User does not exist.");

    // cannot add signatory for user that does not exist
    await expect(
      registrar.connect(account_1).addSignatory(account_2.getAddress())
    ).to.be.revertedWith("User does not exist.");

    // cannot transfer for user that does not exist
    await expect(
      registrar.connect(account_1).transfer(account_2.getAddress())
    ).to.be.revertedWith("User does not exist.");
  });

  it("Cannot add yourself as signatory", async function () {
    // register indentity
    const [firstName, lastName, birthdate] = ["a", "b", 1];
    await registrar.connect(account_1).register(firstName, lastName, birthdate);

    // add a signatory
    await expect(
      registrar.connect(account_1).addSignatory(account_1.getAddress())
    ).to.be.revertedWith("You cannot add yourself as a signatory.");
  });

  it("Person can transfer the identity", async function () {
    // register indentity
    const [firstName, lastName, birthdate] = ["a", "b", 1];
    await registrar.connect(account_1).register(firstName, lastName, birthdate);
    await registrar.connect(account_2).register("c", "d", 2);

    // cannot transfer to existing user
    await expect(
      registrar.connect(account_1).transfer(account_2.getAddress())
    ).to.be.revertedWith("User already registered for this address.");

    // not approved by default -- cannot transfer
    await expect(
      registrar.connect(account_1).transfer(account_4.getAddress())
    ).to.be.revertedWith("Not approved for transfer.");

    // add a signatory
    await registrar.connect(account_1).addSignatory(account_2.getAddress());

    // check if a signatory can approve transfer
    await registrar.connect(account_2).approveTransfer(account_1.getAddress());

    // cannot approve transfer twice within 24 hours
    await expect(
      registrar.connect(account_2).approveTransfer(account_1.getAddress())
    ).to.be.revertedWith("You cannot approve transfer twice within 24 hours.");

    // fast forward 24 hours
    await ethers.provider.send("evm_increaseTime", [TWENTY_FOUR_HOURS]);
    await ethers.provider.send("evm_mine", []);

    // now should be able to approve again
    await registrar.connect(account_2).approveTransfer(account_1.getAddress());

    // shouldn't be able to approve if not a signatory
    await expect(
      registrar.connect(account_3).approveTransfer(account_1.getAddress())
    ).to.be.revertedWith("You are not a signatory for this account.");

    // cannot transfer with just one approval
    await expect(
      registrar.connect(account_1).transfer(account_4.getAddress())
    ).to.be.revertedWith("Not approved for transfer.");

    // add another signatory
    await registrar.connect(account_1).addSignatory(account_3.getAddress());

    // add another approval
    await registrar.connect(account_3).approveTransfer(account_1.getAddress());

    // fast forward 24 hours
    await ethers.provider.send("evm_increaseTime", [TWENTY_FOUR_HOURS]);
    await ethers.provider.send("evm_mine", []);

    // cannot transfer with expired approvals
    await expect(
      registrar.connect(account_1).transfer(account_4.getAddress())
    ).to.be.revertedWith("Not approved for transfer.");

    // should be able to transfer with 2 approval
    await registrar.connect(account_2).approveTransfer(account_1.getAddress());
    await registrar.connect(account_3).approveTransfer(account_1.getAddress());
    const transferTx = await (
      await registrar.connect(account_1).transfer(account_4.getAddress())
    ).wait();

    // check that PersonTransferred event was emitted
    const transferEvent = transferTx?.events[0];
    expect(transferEvent?.event).to.equal("PersonTransferred");
    expect(transferEvent?.args?.fromAddress).to.equal(
      await account_1.getAddress()
    );
    expect(transferEvent?.args?.toAddress).to.equal(
      await account_4.getAddress()
    );

    // new owner can view their user
    expect(
      await registrar.connect(account_4).viewPerson(FIRST_ID)
    ).to.deep.equal([firstName, lastName, BigNumber.from(1)]);

    // original user can no longer view
    await expect(
      registrar.connect(account_1).viewPerson(FIRST_ID)
    ).to.be.revertedWith("Address is not authorized to view this user ID.");
  });
});
