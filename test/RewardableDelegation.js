const { constants, expect, ether } = require('@1inch/solidity-utils');
const hre = require('hardhat');
const { artifacts } = hre;

const RewardableDelegationTopic = artifacts.require('RewardableDelegationTopic');
const DelegateeToken = artifacts.require('DelegateeToken');

describe('RewardableDelegationTopic', async () => {
    let addr1, addr2, delegatee, newDelegatee;
    const maxFarm = 5;

    before(async () => {
        [addr1, addr2, delegatee, newDelegatee] = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        this.delegationTopic = await RewardableDelegationTopic.new('Rewardable', 'RWD');
    });

    describe('register', async () => {
        describe('register(string,string)', async () => {
            it('should registrate delegatee and create new token', async () => {
                expect(await this.delegationTopic.registration(delegatee)).to.be.equals(constants.ZERO_ADDRESS);
                await this.delegationTopic.contract.methods.register('TestTokenName', 'TestTokenSymbol', maxFarm).send({ from: delegatee });
                const delegateeToken = await hre.ethers.getContractAt('DelegateeToken', await this.delegationTopic.registration(delegatee));
                expect(await delegateeToken.name()).to.be.equals('TestTokenName');
                expect(await delegateeToken.symbol()).to.be.equals('TestTokenSymbol');
            });

            it('should mint and burn DelegateeToken only ReawardableDelegation', async () => {
                await this.delegationTopic.contract.methods.register('TestTokenName', 'TestTokenSymbol', maxFarm).send({ from: delegatee });
                const delegateeToken = await hre.ethers.getContractAt('DelegateeToken', await this.delegationTopic.registration(delegatee));
                await expect(delegateeToken.mint(addr1, '1000'))
                    .to.eventually.be.rejectedWith('Ownable: caller is not the owner');
                await expect(delegateeToken.burn(addr1, '1000'))
                    .to.eventually.be.rejectedWith('Ownable: caller is not the owner');
            });

            it('should not double registrate', async () => {
                await this.delegationTopic.contract.methods.register('TestTokenName', 'TestTokenSymbol', maxFarm).send({ from: delegatee });
                await expect(this.delegationTopic.contract.methods.register('TestTokenName2', 'TestTokenSymbol2', maxFarm).send({ from: delegatee }))
                    .to.eventually.be.rejectedWith('AlreadyRegistered()');
            });
        });

        describe('register(IDelegateeToken)', async () => {
            it('should registrate delegatee', async () => {
                const delegateeToken = await DelegateeToken.new('TestTokenName', 'TestTokenSymbol', maxFarm, { from: delegatee });
                await this.delegationTopic.contract.methods.register(delegateeToken.address).send({ from: delegatee });
                expect(await this.delegationTopic.registration(delegatee)).to.be.equals(delegateeToken.address);
            });

            it('should not registrate with already used token', async () => {
                await this.delegationTopic.contract.methods.register('TestTokenName', 'TestTokenSymbol', maxFarm).send({ from: delegatee });
                const delegateeToken = await hre.ethers.getContractAt('DelegateeToken', await this.delegationTopic.registration(delegatee));
                await expect(this.delegationTopic.contract.methods.register(delegateeToken.address).send({ from: newDelegatee }))
                    .to.eventually.be.rejectedWith('AnotherDelegateeToken()');
            });

            it('should not double registrate', async () => {
                const delegateeToken = await DelegateeToken.new('TestTokenName', 'TestTokenSymbol', maxFarm, { from: delegatee });
                await this.delegationTopic.contract.methods.register(delegateeToken.address).send({ from: delegatee });
                await expect(this.delegationTopic.contract.methods.register(delegateeToken.address).send({ from: delegatee }))
                    .to.eventually.be.rejectedWith('AlreadyRegistered()');
            });
        });
    });

    describe('setDelegate', async () => {
        beforeEach(async () => {
            await this.delegationTopic.contract.methods.register('TestTokenName', 'TestTokenSymbol', maxFarm).send({ from: delegatee });
        });

        it('should set delegate and emit Delegate event', async () => {
            const tx = await this.delegationTopic.setDelegate(addr1, delegatee);
            expect(await this.delegationTopic.delegated(addr1)).to.be.equals(delegatee);
            expect(tx.logs[0].event).to.be.equals('Delegate');
        });

        it('should set delegate and emit Undelegate event', async () => {
            const tx = await this.delegationTopic.setDelegate(addr1, constants.ZERO_ADDRESS);
            expect(await this.delegationTopic.delegated(addr1)).to.be.equals(constants.ZERO_ADDRESS);
            expect(tx.logs[0].event).to.be.equals('Undelegate');
        });

        it('should delegate by only owner', async () => {
            await expect(this.delegationTopic.setDelegate(addr1, delegatee, { from: addr2 }))
                .to.eventually.be.rejectedWith('Ownable: caller is not the owner');
        });

        it('should not delegate not registered delegatee', async () => {
            await expect(this.delegationTopic.setDelegate(addr1, newDelegatee))
                .to.eventually.be.rejectedWith('NotRegisteredDelegatee()');
        });
    });

    describe('updateBalances', async () => {
        beforeEach(async () => {
            this.delegateeToken = await DelegateeToken.new('TestTokenName', 'TestTokenSymbol', maxFarm, { from: delegatee });
            await this.delegationTopic.contract.methods.register(this.delegateeToken.address).send({ from: delegatee });
            await this.delegateeToken.transferOwnership(this.delegationTopic.address, { from: delegatee });

            this.newDelegateeToken = await DelegateeToken.new('TestTokenName_2', 'TestTokenName_2', maxFarm, { from: newDelegatee });
            await this.delegationTopic.contract.methods.register(this.newDelegateeToken.address).send({ from: newDelegatee });
            await this.newDelegateeToken.transferOwnership(this.delegationTopic.address, { from: newDelegatee });

            await this.delegationTopic.setDelegate(addr1, delegatee);
            await this.delegationTopic.setDelegate(addr2, newDelegatee);

            this.amount = ether('1');
        });

        it('`address(0) -> addr1` should mint DelegateeToken for addr1', async () => {
            const balanceBefore = await this.delegateeToken.balanceOf(addr1);
            await this.delegationTopic.updateBalances(constants.ZERO_ADDRESS, addr1, this.amount);
            expect(await this.delegateeToken.balanceOf(addr1)).to.be.bignumber.eq(balanceBefore.add(this.amount));
        });

        it('`addr1 -> address(0)` should burn DelegateeToken for addr1', async () => {
            await this.delegationTopic.updateBalances(constants.ZERO_ADDRESS, addr1, this.amount.muln(5));
            const balanceBefore = await this.delegateeToken.balanceOf(addr1);
            await this.delegationTopic.updateBalances(addr1, constants.ZERO_ADDRESS, this.amount);
            expect(await this.delegateeToken.balanceOf(addr1)).to.be.bignumber.eq(balanceBefore.sub(this.amount));
        });

        it('`addr1 -> addr2` should change their DelegateeToken balances', async () => {
            await this.delegationTopic.updateBalances(constants.ZERO_ADDRESS, addr1, this.amount.muln(10));
            await this.delegationTopic.updateBalances(constants.ZERO_ADDRESS, addr2, this.amount.muln(20));
            const balanceBeforeDelegatee = await this.delegationTopic.balanceOf(delegatee);
            const balanceBeforeNewDelegatee = await this.delegationTopic.balanceOf(newDelegatee);
            await this.delegationTopic.updateBalances(addr1, addr2, this.amount);
            expect(await this.delegationTopic.balanceOf(delegatee)).to.be.bignumber.eq(balanceBeforeDelegatee.sub(this.amount));
            expect(await this.delegationTopic.balanceOf(newDelegatee)).to.be.bignumber.eq(balanceBeforeNewDelegatee.add(this.amount));
        });
    });
});
