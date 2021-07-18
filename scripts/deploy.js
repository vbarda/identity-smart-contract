async function main() {
  const Registrar = await ethers.getContractFactory("Registrar");
  const registrar = await Registrar.deploy();

  console.log("Registrar contract address:", registrar.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
