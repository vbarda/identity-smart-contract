pragma solidity ^0.8.0;

/// @title Simple identity registration contract
/// @author Vadym Barda
/// @notice The contract allows the following interactions: 
/// (1) register a person (identity). NOTE: a single address can only register once
/// (2) add authorized viewers that can view personal details for a specified ID. 
///     By default only the address who registered the person can view it
/// (3) view identity (i.e. personal details) for a specified ID
/// (4) add signatories to an address -- approved addresses that can sign off 
///     on certain types of transactions. NOTE: an address cannot add itself as a signatory
/// (5) approve identity transfer, if you're an authorized signatory
/// (6) transfer identity to someone else. Particularly useful if someone
///    changes their wallet. This interaction is subject to two requirements:
///    - needs to be approved by at least 2 signatories
///    - must be completed within the 24-hour window after approval
contract Registrar {

    event PersonRegistered(uint id);
    event ViewerAuthorized(uint id, address viewer);
    event PersonTransferred(uint id, address fromAddress, address toAddress);

    struct Person {
        uint id;
        string firstName;
        string lastName;
        uint birthdate;
    }
    
    struct TransferApproval {
        address signatory;
        uint timestamp;
    }
    
    Person[] people;
    
    mapping(address => uint) addressToUserId;
    mapping(uint => mapping(address => bool)) userIdToAuthorizedViewers;
    mapping(uint => mapping(address => bool)) userIdToSignatories;
    mapping(address => TransferApproval[]) addressToTransferApprovals;
    mapping(address => mapping(address => uint)) addressToSignatoryTransferApprovalTimestamp;
    
    uint8 minApprovalsForTransfer = 2;
    uint transferApprovalTTL = 24 hours;
    
    modifier isNewUser() {
        require(addressToUserId[msg.sender] == 0, "User already exists.");
        _;
    }
    
    modifier userExists() {
        require(addressToUserId[msg.sender] != 0, "User does not exist.");
        _;
    }
    
    function register(string memory firstName, string memory lastName, uint birthdate) external isNewUser {
        uint userId = people.length + 1; // start with 1, and so on
        people.push(Person({id: userId, firstName: firstName, lastName: lastName, birthdate: birthdate}));
        addressToUserId[msg.sender] = userId;
        emit PersonRegistered(userId);
    }
    
    function addAuthorizedViewer(address viewer) external userExists {
        uint id = addressToUserId[msg.sender];
        userIdToAuthorizedViewers[id][viewer] = true;
        emit ViewerAuthorized(id, viewer);
    }
    
    function viewPerson(uint id) external view returns (
        string memory firstName, 
        string memory lastName, 
        uint birthdate
    ) {
        mapping(address => bool) storage authorizedViewers = userIdToAuthorizedViewers[id];
        require(
            addressToUserId[msg.sender] == id || authorizedViewers[msg.sender], 
            "Address is not authorized to view this user ID."
        );
        // This can be further customized by granting different viewing privileges, 
        // and returning different values based on privileges
        Person storage person = people[id - 1];
        firstName = person.firstName;
        lastName = person.lastName;
        birthdate = person.birthdate;
    }
    
    function addSignatory(address signatory) external userExists {
        require(signatory != msg.sender, "You cannot add yourself as a signatory.");
        uint id = addressToUserId[msg.sender];
        userIdToSignatories[id][signatory] = true;
    }
    
    function approveTransfer(address forAddress) external {
        uint id = addressToUserId[forAddress];
        require(userIdToSignatories[id][msg.sender], "You are not a signatory for this account.");
        require(
            block.timestamp > addressToSignatoryTransferApprovalTimestamp[forAddress][msg.sender] + transferApprovalTTL,
            "You cannot approve transfer twice within 24 hours."
        );
        uint currentTimestamp = block.timestamp;
        addressToTransferApprovals[forAddress].push(TransferApproval(msg.sender, currentTimestamp));
        addressToSignatoryTransferApprovalTimestamp[forAddress][msg.sender] = currentTimestamp;
    }
    
    function isApprovedForTransfer(address owner) private view returns(bool) {
        TransferApproval[] storage transferApprovals = addressToTransferApprovals[owner];
        uint8 approvalCount = 0;
        for (uint i=0; i < transferApprovals.length; i++) {
            // needs to be within TTL window
            if (block.timestamp <= transferApprovals[i].timestamp + transferApprovalTTL) {
                approvalCount++;
            }
            if (approvalCount >= minApprovalsForTransfer) {
                return true; 
            }
        }
        return false;
    }
    
    function transfer(address to) external userExists {
        require(addressToUserId[to] == 0, "User already registered for this address.");
        require(isApprovedForTransfer(msg.sender), "Not approved for transfer.");
        uint id = addressToUserId[msg.sender];
        // transfer ID
        delete addressToUserId[msg.sender];
        addressToUserId[to] = id;
        // delete stale approvals
        TransferApproval[] storage transferApprovals = addressToTransferApprovals[msg.sender];
        for (uint i=0; i < transferApprovals.length; i++) {
            delete addressToSignatoryTransferApprovalTimestamp[msg.sender][transferApprovals[i].signatory];    
        }
        delete addressToTransferApprovals[msg.sender];
        emit PersonTransferred(id, msg.sender, to);
        // NOTE: since signatories & viewers are specified per user ID, 
        // and not per address, no further writes are necessary
    }

}
