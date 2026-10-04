# Passenger handoff authorization gap

The protocol does not currently define a trusted passenger handoff grant.
`ActionProposalRequest` is producer supplied, so a grant carried on that
request would let the proposal producer authorize its own disclosure. The
protocol therefore carries no passenger handoff authorization field, and a
proposal's `targetRole` alone never authorizes delivery to a passenger.

Until a separate Center-origin authorization command and its trusted issuer
semantics are defined, proposal content remains visible only under the existing
requester, Center, and cluster rules. A future grant needs to bind one proposal
to one enabled, registered passenger display, limit scope to information
presentation, and expire. It must not confer consent for governed actions or
vehicle operations.
