export const idlFactory = ({ IDL }) => {
  const Sources = IDL.Record({
    'governance' : IDL.Principal,
    'registry' : IDL.Principal,
  });
  const ScenarioSelection = IDL.Variant({
    'A' : IDL.Null,
    'B' : IDL.Null,
    'All' : IDL.Null,
    'BThenA' : IDL.Null,
    'AThenB' : IDL.Null,
  });
  const SelectedProposal = IDL.Record({
    'id' : IDL.Nat64,
    'observation' : IDL.Opt(IDL.Nat64),
  });
  const ReviewRequest = IDL.Record({
    'hypothetical_executed' : IDL.Opt(IDL.Bool),
    'request_missing' : IDL.Bool,
    'registry_version' : IDL.Nat64,
    'scenario' : ScenarioSelection,
    'proposals' : IDL.Vec(SelectedProposal),
  });
  const RegistryKey = IDL.Variant({
    'Operator' : IDL.Principal,
    'Node' : IDL.Principal,
    'ApiBoundary' : IDL.Principal,
    'Subnet' : IDL.Principal,
    'DataCenter' : IDL.Text,
    'Roster' : IDL.Null,
  });
  const ReviewError = IDL.Variant({
    'InvalidCapture' : IDL.Nat64,
    'InvalidRecordEvidence' : RegistryKey,
    'UnsupportedPolicy' : IDL.Null,
    'MalformedPayload' : IDL.Record({
      'id' : IDL.Nat64,
      'observation' : IDL.Nat64,
    }),
    'UnavailableRecord' : RegistryKey,
    'IncompleteBaseline' : IDL.Nat64,
    'MissingProposal' : IDL.Nat64,
    'UnsupportedAction' : IDL.Record({
      'id' : IDL.Nat64,
      'function' : IDL.Opt(IDL.Int32),
      'observation' : IDL.Nat64,
    }),
    'InvalidTopology' : IDL.Null,
    'InvalidSelection' : IDL.Null,
    'InvalidHistoricalEvidence' : IDL.Null,
  });
  const SourceStatus = IDL.Variant({
    'Interrupted' : IDL.Null,
    'Rejected' : IDL.Record({
      'code' : IDL.Opt(IDL.Nat32),
      'message' : IDL.Text,
      'retryable' : IDL.Bool,
    }),
    'Integrity' : IDL.Text,
    'Malformed' : IDL.Text,
    'Valid' : IDL.Null,
    'Unavailable' : IDL.Null,
    'Oversized' : IDL.Null,
  });
  const ReviewFailure = IDL.Variant({
    'InvalidEvidence' : ReviewError,
    'SupersededByExecution' : IDL.Record({
      'id' : IDL.Nat64,
      'execution_observation' : IDL.Nat64,
    }),
    'RegistryRead' : IDL.Record({ 'key' : RegistryKey, 'reason' : IDL.Text }),
    'ReviewLimit' : IDL.Null,
    'UnavailableProposal' : IDL.Record({
      'id' : IDL.Nat64,
      'status' : SourceStatus,
      'observation' : IDL.Nat64,
    }),
  });
  const ReviewJobState = IDL.Variant({
    'Blocked' : ReviewFailure,
    'Complete' : IDL.Vec(IDL.Nat8),
    'Waiting' : IDL.Record({
      'proposals' : IDL.Vec(IDL.Nat64),
      'registry' : IDL.Bool,
    }),
    'Pending' : IDL.Null,
  });
  const ReviewJob = IDL.Record({
    'request' : ReviewRequest,
    'state' : ReviewJobState,
    'queued' : IDL.Vec(IDL.Nat64),
  });
  const Result = IDL.Variant({ 'Ok' : ReviewJob, 'Err' : IDL.Text });
  const Limits = IDL.Record({
    'calls' : IDL.Nat32,
    'attempts' : IDL.Nat8,
    'slices' : IDL.Nat32,
    'duration_secs' : IDL.Nat32,
    'cycle_ceiling' : IDL.Nat,
    'raw_bytes' : IDL.Nat64,
  });
  const Result_1 = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text });
  const LiveUsage = IDL.Record({
    'balance_after' : IDL.Nat,
    'calls' : IDL.Nat32,
    'balance_before' : IDL.Nat,
    'instructions' : IDL.Nat64,
    'source_bytes' : IDL.Nat64,
    'peak_batch_reservation' : IDL.Nat,
    'started_at' : IDL.Nat64,
    'finished_at' : IDL.Nat64,
  });
  const SubnetRules = IDL.Record({
    'kind' : IDL.Int32,
    'subnet' : IDL.Principal,
    'sev_enabled' : IDL.Bool,
  });
  const ScenarioId = IDL.Variant({
    'A' : IDL.Null,
    'B' : IDL.Null,
    'BThenA' : IDL.Null,
    'AThenB' : IDL.Null,
  });
  const Distances = IDL.Record({
    'known_nodes' : IDL.Nat32,
    'maximum_metres' : IDL.Opt(IDL.Nat32),
    'unknown_nodes' : IDL.Nat32,
    'total_pairs' : IDL.Nat64,
    'valid_pairs' : IDL.Nat64,
    'mean_metres' : IDL.Opt(IDL.Nat32),
    'minimum_metres' : IDL.Opt(IDL.Nat32),
  });
  const Dimension = IDL.Variant({
    'Operator' : IDL.Null,
    'RegisteredContinent' : IDL.Null,
    'RegisteredCountry' : IDL.Null,
    'RegisteredOwner' : IDL.Null,
    'DataCenter' : IDL.Null,
    'Provider' : IDL.Null,
  });
  const Group = IDL.Variant({
    'RegisteredLabel' : IDL.Text,
    'Principal' : IDL.Principal,
  });
  const Threshold = IDL.Record({
    'nodes_required' : IDL.Nat32,
    'groups_to_reach' : IDL.Opt(IDL.Nat32),
  });
  const Distribution = IDL.Record({
    'groups' : IDL.Vec(IDL.Tuple(Group, IDL.Nat32)),
    'largest' : IDL.Opt(IDL.Nat32),
    'mean_ratio' : IDL.Opt(IDL.Tuple(IDL.Nat32, IDL.Nat32)),
    'greater_than_one_third' : IDL.Opt(Threshold),
    'smallest' : IDL.Opt(IDL.Nat32),
    'fault_budget_plus_one' : IDL.Opt(Threshold),
    'unknown' : IDL.Nat32,
  });
  const MembershipState = IDL.Record({
    'distances' : Distances,
    'members' : IDL.Vec(IDL.Principal),
    'added' : IDL.Vec(IDL.Principal),
    'baseline_count' : IDL.Nat32,
    'retained' : IDL.Vec(IDL.Principal),
    'distributions' : IDL.Vec(IDL.Tuple(Dimension, Distribution)),
    'member_count' : IDL.Nat32,
    'net_change' : IDL.Int64,
    'removed' : IDL.Vec(IDL.Principal),
  });
  const SubnetReview = IDL.Record({
    'baseline' : MembershipState,
    'after_steps' : IDL.Vec(IDL.Opt(MembershipState)),
  });
  const MembershipAction = IDL.Variant({
    'Add' : IDL.Record({
      'subnet' : IDL.Principal,
      'nodes' : IDL.Vec(IDL.Principal),
    }),
    'Remove' : IDL.Record({ 'nodes' : IDL.Vec(IDL.Principal) }),
    'Change' : IDL.Record({
      'add' : IDL.Vec(IDL.Principal),
      'remove' : IDL.Vec(IDL.Principal),
      'subnet' : IDL.Principal,
    }),
  });
  const FindingCode = IDL.Variant({
    'DuplicateInstruction' : IDL.Null,
    'ConcentrationIncreased' : Dimension,
    'RemovalOutsideTarget' : IDL.Null,
    'UnavailableRegisteredCoordinates' : IDL.Null,
    'HistoricalBaselineUnavailable' : IDL.Null,
    'UnaffectedRemovalCandidate' : IDL.Null,
    'TerminalProposal' : IDL.Int32,
    'EmptyResultingSubnet' : IDL.Null,
    'MissingRegistryMetadata' : IDL.Null,
    'EarlierBaselineHypothesis' : IDL.Null,
    'ExecutedProposalHypothesis' : IDL.Null,
    'AlreadyInTarget' : IDL.Null,
    'AssignedElsewhere' : IDL.Null,
    'RewardTypeMismatch' : IDL.Null,
    'MissingNode' : IDL.Null,
    'PreviouslyUnassigned' : IDL.Null,
    'DeletedNode' : IDL.Null,
    'UnavailableNode' : IDL.Null,
    'MissingSevChipIdentity' : IDL.Null,
    'UnlistedTarget' : IDL.Null,
    'UnknownDimension' : Dimension,
    'OverlappingInstructionsRemovalWins' : IDL.Null,
    'DuplicateResultingMembership' : IDL.Null,
    'InvalidTarget' : IDL.Null,
    'ApiBoundaryAssignment' : IDL.Null,
    'DifferentIntermediateStates' : IDL.Null,
  });
  const Severity = IDL.Variant({
    'Error' : IDL.Null,
    'Note' : IDL.Null,
    'Warning' : IDL.Null,
  });
  const Finding = IDL.Record({
    'subnets' : IDL.Vec(IDL.Principal),
    'code' : FindingCode,
    'step' : IDL.Opt(IDL.Nat8),
    'nodes' : IDL.Vec(IDL.Principal),
    'proposal' : IDL.Opt(IDL.Nat64),
    'severity' : Severity,
    'registry' : IDL.Vec(RegistryKey),
  });
  const StepOutcome = IDL.Variant({
    'Skipped' : IDL.Record({ 'failed_step' : IDL.Nat8 }),
    'Applied' : IDL.Record({
      'writes' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Principal))),
    }),
    'Rejected' : IDL.Null,
  });
  const Step = IDL.Record({
    'requested' : MembershipAction,
    'findings' : IDL.Vec(Finding),
    'proposal' : IDL.Nat64,
    'outcome' : StepOutcome,
  });
  const Scenario = IDL.Record({
    'id' : ScenarioId,
    'subnets' : IDL.Vec(IDL.Tuple(IDL.Principal, SubnetReview)),
    'completed' : IDL.Bool,
    'proposal_ids' : IDL.Vec(IDL.Nat64),
    'steps' : IDL.Vec(Step),
    'findings' : IDL.Vec(Finding),
  });
  const HistoricalHead = IDL.Record({
    'observed_at_nanos' : IDL.Nat64,
    'version' : IDL.Nat64,
    'observation' : IDL.Nat64,
    'raw_hash' : IDL.Vec(IDL.Nat8),
  });
  const ProposalEvidence = IDL.Record({
    'id' : IDL.Nat64,
    'function' : IDL.Int32,
    'proposed_at_seconds' : IDL.Opt(IDL.Nat64),
    'observed_at_nanos' : IDL.Nat64,
    'executed_at_seconds' : IDL.Opt(IDL.Nat64),
    'observation' : IDL.Nat64,
    'raw_hash' : IDL.Vec(IDL.Nat8),
    'decoder' : IDL.Text,
    'lifecycle_status' : IDL.Int32,
    'payload_hash' : IDL.Vec(IDL.Nat8),
  });
  const RecordStamp = IDL.Record({
    'value_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'mutation_time' : IDL.Opt(IDL.Nat64),
    'page_observation' : IDL.Nat64,
    'chunk_observations' : IDL.Vec(IDL.Nat64),
    'mutation_version' : IDL.Nat64,
  });
  const RecordReference = IDL.Variant({
    'Present' : RecordStamp,
    'MissingAtBaseline' : IDL.Null,
    'Deleted' : RecordStamp,
    'Unavailable' : IDL.Record({
      'stamp' : IDL.Opt(RecordStamp),
      'reason' : IDL.Text,
    }),
  });
  const ConcentrationRule = IDL.Variant({
    'GreaterThanOneThird' : IDL.Null,
    'FaultBudgetPlusOne' : IDL.Null,
  });
  const Policy = IDL.Record({
    'warn_on_largest_share_increase' : IDL.Bool,
    'version' : IDL.Nat16,
    'concentration_rule' : ConcentrationRule,
  });
  const ReviewManifest = IDL.Record({
    'metrics_revision' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'schema' : IDL.Nat16,
    'registry_version' : IDL.Nat64,
    'historical_head' : IDL.Opt(HistoricalHead),
    'scenario' : ScenarioSelection,
    'proposals' : IDL.Vec(ProposalEvidence),
    'registry' : IDL.Vec(IDL.Tuple(RegistryKey, RecordReference)),
    'input_hash' : IDL.Vec(IDL.Nat8),
    'policy' : Policy,
    'analysis_version' : IDL.Nat16,
  });
  const Review = IDL.Record({
    'hypothetical_executed' : IDL.Opt(IDL.Bool),
    'scenarios' : IDL.Vec(Scenario),
    'findings' : IDL.Vec(Finding),
    'revision' : IDL.Vec(IDL.Nat8),
    'manifest' : ReviewManifest,
  });
  const CandidateAssignment = IDL.Variant({
    'UnknownOutsideListedSubnets' : IDL.Null,
    'NodeAbsent' : IDL.Null,
    'ApiBoundary' : IDL.Null,
    'ListedSubnet' : IDL.Principal,
  });
  const TransitionSide = IDL.Record({
    'fault_budget' : IDL.Nat32,
    'members' : IDL.Nat32,
    'modeled_unavailable' : IDL.Nat32,
    'remaining' : IDL.Int32,
  });
  const TransitionMargin = IDL.Record({
    'further_faults_to_exceed' : IDL.Nat32,
    'before' : TransitionSide,
    'proposed' : TransitionSide,
    'remaining' : IDL.Int32,
  });
  const SubnetTransition = IDL.Record({
    'subnet' : IDL.Principal,
    'margin' : IDL.Opt(TransitionMargin),
  });
  const MembershipPreconditions = IDL.Variant({
    'Skipped' : IDL.Null,
    'EstablishedInCheckedScope' : IDL.Null,
    'Rejected' : IDL.Null,
    'IncompleteAssignmentCoverage' : IDL.Null,
  });
  const ReviewCheck = IDL.Record({
    'transitions' : IDL.Vec(SubnetTransition),
    'step' : IDL.Nat8,
    'preconditions' : MembershipPreconditions,
    'overlap' : IDL.Vec(IDL.Principal),
    'proposal' : IDL.Nat64,
    'scenario' : ScenarioId,
    'add_duplicates' : IDL.Vec(IDL.Principal),
    'remove_duplicates' : IDL.Vec(IDL.Principal),
  });
  const LiveScope = IDL.Record({
    'subnet' : IDL.Principal,
    'nodes' : IDL.Vec(IDL.Principal),
    'scenario' : ScenarioId,
  });
  const ProposalText = IDL.Record({
    'id' : IDL.Nat64,
    'title' : IDL.Opt(IDL.Text),
    'truncated' : IDL.Bool,
    'summary' : IDL.Text,
  });
  const LiveReview = IDL.Record({
    'subnet_rules' : IDL.Opt(IDL.Vec(SubnetRules)),
    'report' : Review,
    'assignments' : IDL.Vec(IDL.Tuple(IDL.Principal, CandidateAssignment)),
    'total_listed_subnets' : IDL.Opt(IDL.Nat32),
    'review_checks' : IDL.Opt(IDL.Vec(ReviewCheck)),
    'scopes' : IDL.Vec(LiveScope),
    'listed_subnets' : IDL.Nat32,
    'review_context' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'proposal_text' : IDL.Opt(IDL.Vec(ProposalText)),
  });
  const LiveError = IDL.Variant({
    'ProposalChanged' : IDL.Record({
      'id' : IDL.Nat64,
      'status' : IDL.Int32,
      'observation' : IDL.Nat64,
    }),
    'InvalidEvidence' : ReviewError,
    'Deadline' : IDL.Null,
    'Source' : IDL.Record({ 'observation' : IDL.Nat64, 'reason' : IDL.Text }),
    'PublicBudget' : IDL.Null,
    'CallLimit' : IDL.Null,
    'SourceBytes' : IDL.Null,
    'CycleBalance' : IDL.Null,
    'ResultLimit' : IDL.Null,
  });
  const Result_2 = IDL.Variant({ 'Ok' : LiveReview, 'Err' : LiveError });
  const LiveReceipt = IDL.Record({
    'id' : IDL.Nat64,
    'reject' : IDL.Opt(IDL.Text),
    'method' : IDL.Text,
    'argument_hash' : IDL.Vec(IDL.Nat8),
    'reply_bytes' : IDL.Nat64,
    'source' : IDL.Principal,
    'item' : IDL.Text,
    'reply_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'observed_at' : IDL.Nat64,
  });
  const LiveResponse = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_2,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_3 = IDL.Variant({ 'Ok' : LiveResponse, 'Err' : IDL.Text });
  const Stop = IDL.Variant({
    'CycleCeiling' : IDL.Null,
    'Deadline' : IDL.Null,
    'SliceLimit' : IDL.Null,
    'AttemptLimit' : IDL.Null,
    'CallLimit' : IDL.Null,
    'StorageLimit' : IDL.Null,
    'Completed' : IDL.Null,
    'RawByteLimit' : IDL.Null,
    'CycleBalance' : IDL.Null,
  });
  const Usage = IDL.Record({
    'cycles_reserved' : IDL.Nat,
    'observed_balance_decrease' : IDL.Nat,
    'initial_balance' : IDL.Nat,
    'calls' : IDL.Nat32,
    'stop' : IDL.Opt(Stop),
    'measured_instructions' : IDL.Nat64,
    'slices' : IDL.Nat32,
    'raw_bytes' : IDL.Nat64,
    'limits' : Limits,
    'started_at' : IDL.Nat64,
  });
  const Work = IDL.Variant({
    'GovernanceList' : IDL.Record({
      'limit' : IDL.Nat32,
      'before' : IDL.Opt(IDL.Nat64),
    }),
    'RegistryChanges' : IDL.Nat64,
    'RegistryChunk' : IDL.Vec(IDL.Nat8),
    'GovernanceProposal' : IDL.Nat64,
    'NodeMetrics' : IDL.Record({
      'start' : IDL.Nat64,
      'subnet' : IDL.Principal,
    }),
    'RegistryHead' : IDL.Null,
  });
  const CollectionStatus = IDL.Record({
    'storage_page_ceiling' : IDL.Nat64,
    'allocated_pages' : IDL.Nat64,
    'verification_expires_at' : IDL.Opt(IDL.Nat64),
    'enabled' : IDL.Bool,
    'last_observation' : IDL.Nat64,
    'usage' : IDL.Opt(Usage),
    'in_flight' : IDL.Opt(Work),
  });
  const Result_4 = IDL.Variant({ 'Ok' : CollectionStatus, 'Err' : IDL.Text });
  const Node = IDL.Record({
    'operator' : IDL.Opt(IDL.Principal),
    'reward_type' : IDL.Opt(IDL.Int32),
    'has_chip_id' : IDL.Bool,
  });
  const Record = IDL.Variant({
    'Missing' : IDL.Null,
    'Present' : IDL.Record({ 'value' : Node, 'stamp' : RecordStamp }),
    'Deleted' : RecordStamp,
    'Unavailable' : IDL.Record({
      'stamp' : IDL.Opt(RecordStamp),
      'reason' : IDL.Text,
    }),
  });
  const Operator = IDL.Record({
    'provider' : IDL.Opt(IDL.Principal),
    'data_center' : IDL.Text,
  });
  const Record_1 = IDL.Variant({
    'Missing' : IDL.Null,
    'Present' : IDL.Record({ 'value' : Operator, 'stamp' : RecordStamp }),
    'Deleted' : RecordStamp,
    'Unavailable' : IDL.Record({
      'stamp' : IDL.Opt(RecordStamp),
      'reason' : IDL.Text,
    }),
  });
  const Coordinates = IDL.Record({
    'longitude_e7' : IDL.Int32,
    'latitude_e7' : IDL.Int32,
  });
  const DataCenter = IDL.Record({
    'registered_owner' : IDL.Text,
    'registered_region' : IDL.Text,
    'coordinates' : IDL.Opt(Coordinates),
  });
  const Record_2 = IDL.Variant({
    'Missing' : IDL.Null,
    'Present' : IDL.Record({ 'value' : DataCenter, 'stamp' : RecordStamp }),
    'Deleted' : RecordStamp,
    'Unavailable' : IDL.Record({
      'stamp' : IDL.Opt(RecordStamp),
      'reason' : IDL.Text,
    }),
  });
  const DetailComparisonInput = IDL.Record({
    'after' : IDL.Vec(IDL.Principal),
    'kind' : IDL.Int32,
    'registry_version' : IDL.Nat64,
    'subnet' : IDL.Principal,
    'before' : IDL.Vec(IDL.Principal),
    'nodes' : IDL.Vec(IDL.Tuple(IDL.Principal, Record)),
    'operators' : IDL.Vec(IDL.Tuple(IDL.Principal, Record_1)),
    'preview_revision' : IDL.Vec(IDL.Nat8),
    'data_centers' : IDL.Vec(IDL.Tuple(IDL.Text, Record_2)),
  });
  const MembershipComparison = IDL.Record({
    'baseline' : MembershipState,
    'registered_area_before' : Distribution,
    'selected' : MembershipState,
    'registered_area_after' : Distribution,
  });
  const TargetMetric = IDL.Variant({
    'Size' : IDL.Null,
    'RegisteredCountry' : IDL.Null,
    'RegisteredOwner' : IDL.Null,
    'DataCenter' : IDL.Null,
    'Provider' : IDL.Null,
  });
  const BreachChange = IDL.Variant({
    'New' : IDL.Null,
    'Unchanged' : IDL.Null,
    'Worsened' : IDL.Null,
    'Improved' : IDL.Null,
    'Resolved' : IDL.Null,
  });
  const Assessment = IDL.Variant({
    'IdentityUnresolved' : IDL.Null,
    'MatchesTarget' : IDL.Null,
    'ExceedsLimit' : IDL.Null,
    'WithinLimit' : IDL.Null,
    'ExceptionUnresolved' : IDL.Null,
    'DataIncomplete' : IDL.Null,
    'DiffersFromTarget' : IDL.Null,
    'AtLimit' : IDL.Null,
  });
  const TargetGroup = IDL.Record({
    'breach' : IDL.Opt(BreachChange),
    'after' : IDL.Opt(IDL.Nat32),
    'assessment' : Assessment,
    'before_assessment' : Assessment,
    'group' : Group,
    'before' : IDL.Opt(IDL.Nat32),
  });
  const TargetRow = IDL.Record({
    'metric' : TargetMetric,
    'breach' : IDL.Opt(BreachChange),
    'groups' : IDL.Opt(IDL.Vec(TargetGroup)),
    'after' : IDL.Opt(IDL.Nat32),
    'assessment' : Assessment,
    'limit' : IDL.Nat32,
    'before_assessment' : Assessment,
    'before' : IDL.Opt(IDL.Nat32),
    'unknown_after' : IDL.Nat32,
    'unknown_before' : IDL.Nat32,
  });
  const LiveMembershipComparison = IDL.Record({
    'comparison' : MembershipComparison,
    'instructions' : IDL.Nat64,
    'input_hash' : IDL.Vec(IDL.Nat8),
    'target_rows' : IDL.Opt(IDL.Vec(TargetRow)),
    'analysis_version' : IDL.Nat16,
  });
  const Result_5 = IDL.Variant({
    'Ok' : LiveMembershipComparison,
    'Err' : IDL.Text,
  });
  const RegistryLimits = IDL.Record({
    'staged_mutations' : IDL.Nat32,
    'record_bytes' : IDL.Nat32,
    'record_chunks' : IDL.Nat32,
    'page_mutations' : IDL.Nat32,
  });
  const DiscoveryStatus = IDL.Record({
    'next_discovery' : IDL.Nat64,
    'in_progress' : IDL.Bool,
    'last_discovery_observation' : IDL.Opt(IDL.Nat64),
    'high_watermark' : IDL.Opt(IDL.Nat64),
    'queued' : IDL.Nat32,
    'oldest_scanned' : IDL.Opt(IDL.Nat64),
  });
  const Result_6 = IDL.Variant({ 'Ok' : DiscoveryStatus, 'Err' : IDL.Text });
  const ReplyPage = IDL.Record({
    'bytes' : IDL.Vec(IDL.Nat8),
    'next_offset' : IDL.Opt(IDL.Nat32),
  });
  const Result_7 = IDL.Variant({ 'Ok' : ReplyPage, 'Err' : IDL.Text });
  const SourceObservation = IDL.Record({
    'id' : IDL.Nat64,
    'argument' : IDL.Vec(IDL.Nat8),
    'status' : SourceStatus,
    'method' : IDL.Text,
    'argument_hash' : IDL.Vec(IDL.Nat8),
    'dispatched_at' : IDL.Nat64,
    'source' : IDL.Principal,
    'decoder_revision' : IDL.Text,
    'raw_bytes' : IDL.Opt(IDL.Nat32),
    'raw_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'observed_at' : IDL.Nat64,
  });
  const EvidenceManifest = IDL.Record({
    'manifest_id' : IDL.Vec(IDL.Nat8),
    'registry_version' : IDL.Opt(IDL.Nat64),
    'schema_version' : IDL.Nat16,
    'observations' : IDL.Vec(SourceObservation),
  });
  const Result_8 = IDL.Variant({ 'Ok' : EvidenceManifest, 'Err' : IDL.Text });
  const Result_9 = IDL.Variant({
    'Ok' : IDL.Vec(ProposalEvidence),
    'Err' : LiveError,
  });
  const LiveResponse_1 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_9,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_10 = IDL.Variant({ 'Ok' : LiveResponse_1, 'Err' : IDL.Text });
  const CompletedReview = IDL.Record({
    'hypothetical_executed' : IDL.Opt(IDL.Bool),
    'registry_version' : IDL.Nat64,
    'proposals' : IDL.Vec(IDL.Nat64),
    'revision' : IDL.Vec(IDL.Nat8),
  });
  const DetailKeys = IDL.Variant({
    'Nodes' : IDL.Vec(IDL.Principal),
    'DataCenters' : IDL.Vec(IDL.Text),
    'Operators' : IDL.Vec(IDL.Principal),
  });
  const DetailRecords = IDL.Variant({
    'Nodes' : IDL.Vec(Record),
    'DataCenters' : IDL.Vec(Record_2),
    'Operators' : IDL.Vec(Record_1),
  });
  const Result_11 = IDL.Variant({ 'Ok' : DetailRecords, 'Err' : LiveError });
  const LiveResponse_2 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_11,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_12 = IDL.Variant({ 'Ok' : LiveResponse_2, 'Err' : IDL.Text });
  const RegistryRole = IDL.Record({
    'issue' : IDL.Opt(IDL.Text),
    'retryable' : IDL.Bool,
    'mutation_version' : IDL.Opt(IDL.Nat64),
    'nns_subnet' : IDL.Opt(IDL.Principal),
    'record' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Result_13 = IDL.Variant({ 'Ok' : RegistryRole, 'Err' : LiveError });
  const LiveResponse_3 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_13,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_14 = IDL.Variant({ 'Ok' : LiveResponse_3, 'Err' : IDL.Text });
  const ScopeCursor = IDL.Record({
    'after' : IDL.Principal,
    'selection' : IDL.Vec(IDL.Nat8),
  });
  const NodeRole = IDL.Variant({
    'FinalMember' : IDL.Null,
    'Retained' : IDL.Null,
    'MentionedForAddition' : IDL.Null,
    'RemovedInStep' : IDL.Null,
    'MentionedForRemoval' : IDL.Null,
    'NetRemoved' : IDL.Null,
    'ParticipatedInAppliedState' : IDL.Null,
    'AddedInStep' : IDL.Null,
    'BaselineMember' : IDL.Null,
    'NetAdded' : IDL.Null,
  });
  const ScopeRequest = IDL.Record({
    'cursor' : IDL.Opt(ScopeCursor),
    'subnet' : IDL.Principal,
    'nodes' : IDL.Opt(IDL.Vec(IDL.Principal)),
    'scenario' : ScenarioId,
    'revision' : IDL.Vec(IDL.Nat8),
    'roles' : IDL.Opt(IDL.Vec(NodeRole)),
  });
  const StepParticipation = IDL.Record({
    'after' : IDL.Opt(IDL.Bool),
    'requested_remove' : IDL.Bool,
    'step' : IDL.Nat8,
    'before' : IDL.Opt(IDL.Bool),
    'requested_add' : IDL.Bool,
  });
  const ScopedNode = IDL.Record({
    'steps' : IDL.Vec(StepParticipation),
    'roles' : IDL.Vec(NodeRole),
  });
  const ScopeIdentity = IDL.Record({
    'metrics_revision' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'evidence_revision' : IDL.Vec(IDL.Nat8),
    'target_subnet' : IDL.Principal,
    'review_revision' : IDL.Vec(IDL.Nat8),
    'baseline_registry_version' : IDL.Nat64,
    'scenario' : ScenarioId,
    'ordered_proposals' : IDL.Vec(IDL.Nat64),
    'analysis_version' : IDL.Nat16,
  });
  const ScopeUnavailable = IDL.Variant({
    'ScenarioUnavailable' : IDL.Null,
    'SubnetOutsideReview' : IDL.Null,
  });
  const ScopePage = IDL.Variant({
    'Nodes' : IDL.Record({
      'next' : IDL.Opt(IDL.Principal),
      'rows' : IDL.Vec(IDL.Tuple(IDL.Principal, ScopedNode)),
      'selection' : IDL.Vec(IDL.Nat8),
      'identity' : ScopeIdentity,
    }),
    'Unavailable' : ScopeUnavailable,
  });
  const Result_15 = IDL.Variant({ 'Ok' : ScopePage, 'Err' : IDL.Text });
  const NnsTarget = IDL.Record({
    'clause' : IDL.Text,
    'exception' : IDL.Opt(IDL.Text),
    'size' : IDL.Nat32,
    'country_cap' : IDL.Nat32,
    'group_cap' : IDL.Nat32,
    'sev_designated' : IDL.Bool,
  });
  const PolicyMotion = IDL.Record({
    'id' : IDL.Nat64,
    'raw' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'status' : IDL.Opt(IDL.Int32),
    'rule' : IDL.Opt(NnsTarget),
    'issue' : IDL.Opt(IDL.Text),
    'raw_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'retryable' : IDL.Bool,
    'observed_at' : IDL.Opt(IDL.Nat64),
  });
  const PolicySnapshot = IDL.Record({
    'nns_retryable' : IDL.Bool,
    'nns_record' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'nns_issue' : IDL.Opt(IDL.Text),
    'digest' : IDL.Vec(IDL.Nat8),
    'motion' : IDL.Opt(PolicyMotion),
    'nns_mutation_version' : IDL.Opt(IDL.Nat64),
    'nns_subnet' : IDL.Opt(IDL.Principal),
  });
  const Result_16 = IDL.Variant({ 'Ok' : PolicySnapshot, 'Err' : LiveError });
  const LiveResponse_4 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_16,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_17 = IDL.Variant({ 'Ok' : LiveResponse_4, 'Err' : IDL.Text });
  const MetricConflict = IDL.Record({
    'conflicting_hash' : IDL.Vec(IDL.Nat8),
    'raw_response_hash' : IDL.Vec(IDL.Nat8),
    'previous_hash' : IDL.Vec(IDL.Nat8),
    'observation' : IDL.Nat64,
    'observed_at' : IDL.Nat64,
  });
  const MetricConflictPage = IDL.Record({
    'next' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'rows' : IDL.Vec(MetricConflict),
  });
  const Result_18 = IDL.Variant({
    'Ok' : MetricConflictPage,
    'Err' : IDL.Text,
  });
  const CollectionGap = IDL.Variant({
    'BoundaryMissing' : IDL.Record({
      'expected' : IDL.Nat64,
      'earliest' : IDL.Opt(IDL.Nat64),
    }),
    'ShortenedHistory' : IDL.Record({
      'requested' : IDL.Nat64,
      'from' : IDL.Nat64,
    }),
    'MissingDays' : IDL.Record({ 'after' : IDL.Nat64, 'before' : IDL.Nat64 }),
  });
  const MetricSample = IDL.Record({
    'node_rows' : IDL.Nat32,
    'timestamp_nanos' : IDL.Nat64,
    'preceding_gap' : IDL.Opt(CollectionGap),
    'raw_response_hash' : IDL.Vec(IDL.Nat8),
    'sample_hash' : IDL.Vec(IDL.Nat8),
    'previous_sample' : IDL.Opt(IDL.Nat64),
    'subnet' : IDL.Principal,
    'observation' : IDL.Nat64,
    'decreased_counters' : IDL.Nat32,
    'collected_at' : IDL.Nat64,
    'conflicted' : IDL.Bool,
  });
  const NodeMetrics = IDL.Record({
    'num_block_failures_total' : IDL.Nat64,
    'node_id' : IDL.Principal,
    'num_blocks_proposed_total' : IDL.Nat64,
  });
  const MetricRows = IDL.Record({
    'sample' : MetricSample,
    'next' : IDL.Opt(IDL.Principal),
    'rows' : IDL.Vec(NodeMetrics),
  });
  const Result_19 = IDL.Variant({ 'Ok' : MetricRows, 'Err' : IDL.Text });
  const HistoryKind = IDL.Variant({
    'Empty' : IDL.Null,
    'MissingBoundary' : IDL.Null,
    'Samples' : IDL.Null,
    'BoundaryOnly' : IDL.Null,
  });
  const SuccessfulHistory = IDL.Record({
    'kind' : HistoryKind,
    'observation' : IDL.Nat64,
    'raw_hash' : IDL.Vec(IDL.Nat8),
    'collected_at' : IDL.Nat64,
  });
  const SubnetCollection = IDL.Record({
    'next_due' : IDL.Opt(IDL.Nat64),
    'gap' : IDL.Opt(CollectionGap),
    'failures' : IDL.Nat8,
    'gaps_observed' : IDL.Nat64,
    'cursor' : IDL.Opt(IDL.Nat64),
    'last_status' : IDL.Opt(SourceStatus),
    'last_success_at' : IDL.Opt(IDL.Nat64),
    'last_success' : IDL.Opt(SuccessfulHistory),
    'last_observation' : IDL.Opt(IDL.Nat64),
    'eligible' : IDL.Bool,
    'history_retry_start' : IDL.Opt(IDL.Nat64),
  });
  const MetricPage = IDL.Record({
    'collection' : SubnetCollection,
    'next' : IDL.Opt(IDL.Nat64),
    'rows' : IDL.Vec(MetricSample),
  });
  const Result_20 = IDL.Variant({ 'Ok' : MetricPage, 'Err' : IDL.Text });
  const MetricsRosterStatus = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'error' : IDL.Opt(IDL.Text),
    'eligible_count' : IDL.Nat32,
    'unsupported' : IDL.Vec(IDL.Principal),
  });
  const Result_21 = IDL.Variant({
    'Ok' : MetricsRosterStatus,
    'Err' : IDL.Text,
  });
  const Result_22 = IDL.Variant({ 'Ok' : SubnetCollection, 'Err' : IDL.Text });
  const NodeMetricsHistoryRecord = IDL.Record({
    'timestamp_nanos' : IDL.Nat64,
    'node_metrics' : IDL.Vec(NodeMetrics),
  });
  const LivePerformance = IDL.Record({
    'start_at_timestamp_nanos' : IDL.Nat64,
    'samples' : IDL.Vec(NodeMetricsHistoryRecord),
    'subnet' : IDL.Principal,
  });
  const Result_23 = IDL.Variant({ 'Ok' : LivePerformance, 'Err' : LiveError });
  const LiveResponse_5 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_23,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_24 = IDL.Variant({ 'Ok' : LiveResponse_5, 'Err' : IDL.Text });
  const ProbeBudget = IDL.Record({
    'migrated_from_m0' : IDL.Bool,
    'usage' : Usage,
  });
  const Result_25 = IDL.Variant({ 'Ok' : ProbeBudget, 'Err' : IDL.Text });
  const ListedProposal = IDL.Record({
    'id' : IDL.Nat64,
    'function' : IDL.Opt(IDL.Int32),
    'listed_payload_bytes' : IDL.Opt(IDL.Nat32),
  });
  const Key = IDL.Variant({
    'Operator' : IDL.Principal,
    'Node' : IDL.Principal,
    'MissingProbe' : IDL.Null,
    'Subnet' : IDL.Principal,
    'SubnetList' : IDL.Null,
    'DataCenter' : IDL.Text,
  });
  const RecordSummary = IDL.Variant({
    'Operator' : IDL.Record({ 'dc' : IDL.Text, 'provider' : IDL.Principal }),
    'Node' : IDL.Record({ 'operator' : IDL.Principal }),
    'Subnet' : IDL.Record({
      'first' : IDL.Opt(IDL.Principal),
      'configured_version' : IDL.Text,
      'member_count' : IDL.Nat32,
      'subnet_type' : IDL.Int32,
    }),
    'SubnetList' : IDL.Record({
      'first' : IDL.Opt(IDL.Principal),
      'count' : IDL.Nat32,
    }),
    'DataCenter' : IDL.Record({
      'id' : IDL.Text,
      'region' : IDL.Text,
      'has_gps' : IDL.Bool,
      'registered_owner' : IDL.Text,
    }),
  });
  const VersionSpan = IDL.Record({
    'mutations' : IDL.Nat32,
    'requested_after' : IDL.Nat64,
    'chunked_mutations' : IDL.Nat32,
    'delivered_through' : IDL.Nat64,
    'distinct_keys' : IDL.Nat32,
    'observed_head' : IDL.Nat64,
    'tombstones' : IDL.Nat32,
  });
  const Assembled = IDL.Record({
    'hash' : IDL.Vec(IDL.Nat8),
    'bytes' : IDL.Nat32,
    'record' : IDL.Opt(RecordSummary),
  });
  const Observation = IDL.Variant({
    'ProposalList' : IDL.Vec(ListedProposal),
    'RegistryChunks' : IDL.Record({
      'registry_key' : IDL.Text,
      'hashes' : IDL.Vec(IDL.Vec(IDL.Nat8)),
      'mutation_version' : IDL.Nat64,
    }),
    'InvalidResponse' : IDL.Text,
    'RegistryValue' : IDL.Record({
      'key' : Key,
      'source_timestamp_nanos' : IDL.Opt(IDL.Nat64),
      'requested_version' : IDL.Nat64,
      'mutation_version' : IDL.Nat64,
      'record' : RecordSummary,
    }),
    'Rejected' : IDL.Record({
      'code' : IDL.Opt(IDL.Nat32),
      'message' : IDL.Text,
      'retryable' : IDL.Bool,
    }),
    'Proposal' : IDL.Record({
      'id' : IDL.Nat64,
      'status' : IDL.Int32,
      'topic' : IDL.Int32,
      'function' : IDL.Opt(IDL.Int32),
      'payload_bytes' : IDL.Opt(IDL.Nat32),
      'proposal_time_seconds' : IDL.Nat64,
      'membership' : IDL.Opt(MembershipAction),
      'executed_time_seconds' : IDL.Opt(IDL.Nat64),
      'payload_decode_error' : IDL.Opt(IDL.Text),
      'payload_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    }),
    'RegistryHead' : IDL.Nat64,
    'RegistryPage' : VersionSpan,
    'Chunk' : IDL.Record({
      'hash' : IDL.Vec(IDL.Nat8),
      'assembled' : IDL.Opt(Assembled),
      'bytes' : IDL.Nat32,
    }),
    'SubnetInfo' : IDL.Record({
      'replica_version' : IDL.Text,
      'registry_version' : IDL.Nat64,
      'subnet' : IDL.Principal,
    }),
    'Unavailable' : IDL.Null,
    'Metrics' : IDL.Record({
      'requested_start_nanos' : IDL.Nat64,
      'first_sample_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'sample_count' : IDL.Nat32,
      'overlap_matches' : IDL.Opt(IDL.Bool),
      'maximum_rows' : IDL.Opt(IDL.Nat32),
      'subnet' : IDL.Principal,
      'first_timestamp_nanos' : IDL.Opt(IDL.Nat64),
      'last_timestamp_nanos' : IDL.Opt(IDL.Nat64),
      'minimum_rows' : IDL.Opt(IDL.Nat32),
    }),
  });
  const Receipt = IDL.Record({
    'method' : IDL.Text,
    'sent_at_nanos' : IDL.Nat64,
    'cycles_at_callback' : IDL.Nat,
    'attempt' : IDL.Nat8,
    'source' : IDL.Principal,
    'request' : IDL.Vec(IDL.Nat8),
    'decoder_revision' : IDL.Text,
    'calling_subnet' : IDL.Principal,
    'job_id' : IDL.Nat64,
    'received_at_nanos' : IDL.Nat64,
    'calling_canister' : IDL.Principal,
    'raw_bytes' : IDL.Opt(IDL.Nat32),
    'observation' : Observation,
    'index' : IDL.Nat32,
    'raw_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'cycles_before' : IDL.Nat,
  });
  const Result_26 = IDL.Variant({ 'Ok' : Receipt, 'Err' : IDL.Text });
  const Status = IDL.Record({
    'caller_subnet' : IDL.Principal,
    'captured_registry_head' : IDL.Opt(IDL.Nat64),
    'receipt_count' : IDL.Nat32,
    'cycles' : IDL.Nat,
    'job_id' : IDL.Nat64,
    'remaining_steps' : IDL.Nat32,
    'detected_remote_subnet' : IDL.Opt(IDL.Principal),
    'completed_at_nanos' : IDL.Opt(IDL.Nat64),
    'in_flight' : IDL.Bool,
    'stable_pages' : IDL.Nat64,
    'stored_reply_bytes' : IDL.Nat64,
    'started_at_nanos' : IDL.Nat64,
    'stop_reason' : IDL.Opt(IDL.Text),
  });
  const Result_27 = IDL.Variant({ 'Ok' : Status, 'Err' : IDL.Text });
  const Result_28 = IDL.Variant({ 'Ok' : MembershipAction, 'Err' : IDL.Text });
  const ActionStatus = IDL.Variant({
    'MalformedPayload' : IDL.Text,
    'UnsupportedAction' : IDL.Null,
    'Membership' : IDL.Null,
    'UnsupportedFunction' : IDL.Int32,
  });
  const Lifecycle = IDL.Record({
    'status' : IDL.Int32,
    'decided_at_seconds' : IDL.Opt(IDL.Nat64),
    'topic' : IDL.Int32,
    'proposed_at_seconds' : IDL.Nat64,
    'executed_at_seconds' : IDL.Opt(IDL.Nat64),
    'failed_at_seconds' : IDL.Opt(IDL.Nat64),
  });
  const ProposalCapture = IDL.Record({
    'function' : IDL.Opt(IDL.Int32),
    'action_status' : ActionStatus,
    'claim_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'proposal_id' : IDL.Nat64,
    'observation' : IDL.Nat64,
    'lifecycle' : Lifecycle,
    'raw_hash' : IDL.Vec(IDL.Nat8),
    'collected_at' : IDL.Nat64,
    'payload_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Result_29 = IDL.Variant({ 'Ok' : ProposalCapture, 'Err' : IDL.Text });
  const CapturePage = IDL.Record({
    'next' : IDL.Opt(IDL.Nat64),
    'rows' : IDL.Vec(ProposalCapture),
  });
  const Result_30 = IDL.Variant({ 'Ok' : CapturePage, 'Err' : IDL.Text });
  const ProposalStatus = IDL.Record({
    'last_status' : IDL.Opt(SourceStatus),
    'next_lifecycle_check' : IDL.Opt(IDL.Nat64),
    'last_capture' : IDL.Opt(IDL.Nat64),
    'last_observation' : IDL.Opt(IDL.Nat64),
    'capture_count' : IDL.Nat64,
  });
  const Result_31 = IDL.Variant({ 'Ok' : ProposalStatus, 'Err' : IDL.Text });
  const PerformanceRequest = IDL.Record({
    'scope' : ScopeRequest,
    'timestamp' : IDL.Opt(IDL.Nat64),
  });
  const PerformancePage = IDL.Record({
    'sample' : IDL.Opt(MetricSample),
    'rows' : IDL.Vec(NodeMetrics),
    'last_success_at' : IDL.Opt(IDL.Nat64),
    'scope' : ScopePage,
  });
  const Result_32 = IDL.Variant({ 'Ok' : PerformancePage, 'Err' : IDL.Text });
  const Result_33 = IDL.Variant({ 'Ok' : Review, 'Err' : IDL.Text });
  const Assignment = IDL.Variant({
    'UnknownNode' : IDL.Null,
    'Replica' : IDL.Principal,
    'ApiBoundary' : IDL.Null,
    'Unassigned' : IDL.Null,
    'Incomplete' : IDL.Text,
    'Conflict' : IDL.Record({
      'replicas' : IDL.Vec(IDL.Principal),
      'api_boundary' : IDL.Bool,
    }),
  });
  const Result_34 = IDL.Variant({ 'Ok' : Assignment, 'Err' : IDL.Text });
  const RecordKey = IDL.Variant({
    'Operator' : IDL.Principal,
    'Node' : IDL.Principal,
    'ReplicaVersion' : IDL.Text,
    'UnassignedConfig' : IDL.Null,
    'ApiBoundary' : IDL.Principal,
    'StandardEngineVersion' : IDL.Null,
    'Subnet' : IDL.Principal,
    'SubnetList' : IDL.Null,
    'DataCenter' : IDL.Text,
  });
  const KeyPage = IDL.Record({
    'keys' : IDL.Vec(RecordKey),
    'next' : IDL.Opt(IDL.Text),
  });
  const Result_35 = IDL.Variant({ 'Ok' : KeyPage, 'Err' : IDL.Text });
  const RecordEvidence = IDL.Record({
    'value_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'page' : IDL.Nat64,
    'source_time' : IDL.Opt(IDL.Nat64),
    'chunks' : IDL.Vec(IDL.Nat64),
    'mutation_version' : IDL.Nat64,
  });
  const ProviderPage = IDL.Record({
    'next' : IDL.Opt(IDL.Text),
    'operators' : IDL.Vec(IDL.Tuple(IDL.Principal, RecordEvidence)),
  });
  const Result_36 = IDL.Variant({ 'Ok' : ProviderPage, 'Err' : IDL.Text });
  const Endpoint = IDL.Record({ 'ip' : IDL.Text, 'port' : IDL.Nat32 });
  const Position = IDL.Record({
    'latitude' : IDL.Float32,
    'longitude' : IDL.Float32,
  });
  const Details = IDL.Variant({
    'Operator' : IDL.Record({
      'provider' : IDL.Opt(IDL.Principal),
      'allowance' : IDL.Nat64,
      'data_center' : IDL.Text,
    }),
    'Node' : IDL.Record({
      'domain' : IDL.Opt(IDL.Text),
      'operator' : IDL.Opt(IDL.Principal),
      'http' : IDL.Opt(Endpoint),
      'ipv4' : IDL.Opt(IDL.Text),
      'xnet' : IDL.Opt(Endpoint),
      'reward_type' : IDL.Opt(IDL.Int32),
      'has_chip_id' : IDL.Opt(IDL.Bool),
      'hostos' : IDL.Opt(IDL.Text),
    }),
    'ReplicaVersion' : IDL.Record({
      'archive_hash' : IDL.Text,
      'archive_urls' : IDL.Vec(IDL.Text),
    }),
    'UnassignedConfig' : IDL.Record({ 'configured_version' : IDL.Text }),
    'ApiBoundary' : IDL.Record({ 'configured_version' : IDL.Text }),
    'StandardEngineVersion' : IDL.Record({
      'new_version' : IDL.Text,
      'old_version' : IDL.Text,
      'deployment_progress' : IDL.Float64,
    }),
    'Subnet' : IDL.Record({
      'members' : IDL.Vec(IDL.Principal),
      'configured_version' : IDL.Text,
      'kind' : IDL.Int32,
      'sev_enabled' : IDL.Opt(IDL.Bool),
      'halted' : IDL.Bool,
    }),
    'SubnetList' : IDL.Vec(IDL.Principal),
    'DataCenter' : IDL.Record({
      'id' : IDL.Text,
      'gps' : IDL.Opt(Position),
      'registered_owner' : IDL.Text,
      'registered_region' : IDL.Text,
    }),
  });
  const RecordAt = IDL.Variant({
    'Missing' : IDL.Null,
    'Present' : IDL.Record({
      'evidence' : RecordEvidence,
      'details' : Details,
    }),
    'Opaque' : IDL.Record({ 'evidence' : RecordEvidence, 'reason' : IDL.Text }),
    'Deleted' : RecordEvidence,
  });
  const Result_37 = IDL.Variant({ 'Ok' : RecordAt, 'Err' : IDL.Text });
  const Staging = IDL.Record({
    'end' : IDL.Nat64,
    'count' : IDL.Nat32,
    'applied' : IDL.Nat32,
    'observation' : IDL.Nat64,
    'input_mutations' : IDL.Nat32,
    'superseded_mutations' : IDL.Nat32,
  });
  const RegistryLimit = IDL.Variant({
    'RecordBytes' : IDL.Null,
    'RecordChunks' : IDL.Null,
    'StagedMutations' : IDL.Null,
    'PageMutations' : IDL.Null,
  });
  const RegistryRecovery = IDL.Variant({
    'RepairSource' : IDL.Null,
    'UpgradeAdapter' : IDL.Null,
    'IncreaseLimit' : IDL.Record({
      'limit' : RegistryLimit,
      'required' : IDL.Nat32,
    }),
    'RetryTransient' : IDL.Null,
  });
  const RegistryBlock = IDL.Record({
    'cursor' : IDL.Nat64,
    'request' : Work,
    'adapter_revision' : IDL.Nat32,
    'record_key' : IDL.Opt(IDL.Text),
    'observation' : IDL.Nat64,
    'recovery' : RegistryRecovery,
    'version_range' : IDL.Opt(IDL.Tuple(IDL.Nat64, IDL.Nat64)),
    'reason' : IDL.Text,
  });
  const RegistryStatus = IDL.Record({
    'next_due' : IDL.Nat64,
    'processed_mutations' : IDL.Nat64,
    'updated_at' : IDL.Opt(IDL.Nat64),
    'staging' : IDL.Opt(Staging),
    'retained_value_bytes' : IDL.Nat64,
    'blocked' : IDL.Opt(IDL.Text),
    'published' : IDL.Opt(IDL.Nat64),
    'ingested_through' : IDL.Nat64,
    'attempts' : IDL.Nat8,
    'bootstrap_target' : IDL.Opt(IDL.Nat64),
    'wire_bytes' : IDL.Nat64,
    'last_observation' : IDL.Opt(IDL.Nat64),
    'retained_mutations' : IDL.Nat64,
    'block' : IDL.Opt(RegistryBlock),
    'observed_head' : IDL.Opt(IDL.Nat64),
    'limits' : IDL.Opt(RegistryLimits),
    'superseded_mutations' : IDL.Nat64,
  });
  const Result_38 = IDL.Variant({ 'Ok' : RegistryStatus, 'Err' : IDL.Text });
  const Result_39 = IDL.Variant({ 'Ok' : IDL.Vec(IDL.Nat8), 'Err' : IDL.Text });
  const Result_40 = IDL.Variant({ 'Ok' : SourceObservation, 'Err' : IDL.Text });
  const ProbeRequest = IDL.Record({
    'registry_subnet' : IDL.Opt(IDL.Principal),
    'metrics_start_nanos' : IDL.Nat64,
    'remote_subnet' : IDL.Opt(IDL.Principal),
    'proposal_id' : IDL.Opt(IDL.Nat64),
  });
  const Result_41 = IDL.Variant({ 'Ok' : IDL.Nat64, 'Err' : IDL.Text });
  const NodeReferenceRole = IDL.Variant({
    'BoundaryAddition' : IDL.Null,
    'RegistryRemoval' : IDL.Null,
    'Textual' : IDL.Null,
    'BoundaryVersionTarget' : IDL.Null,
    'Outgoing' : IDL.Null,
    'NewSubnetMember' : IDL.Null,
    'BoundaryRemoval' : IDL.Null,
    'Incoming' : IDL.Null,
  });
  const ActivityMatch = IDL.Record({
    'requested_role' : NodeReferenceRole,
    'other_role' : NodeReferenceRole,
    'other' : IDL.Nat64,
    'node' : IDL.Principal,
    'proposal' : IDL.Nat64,
  });
  const ActivityCoverage = IDL.Record({
    'changed_lifecycle' : IDL.Nat32,
    'executable_decoded' : IDL.Nat32,
    'open_listed' : IDL.Nat32,
    'malformed_payloads' : IDL.Nat32,
    'pagination_complete' : IDL.Bool,
    'oldest_listed' : IDL.Opt(IDL.Nat64),
    'unsupported_actions' : IDL.Nat32,
    'omitted_matches' : IDL.Nat32,
    'missing_payloads' : IDL.Nat32,
    'issues' : IDL.Vec(IDL.Text),
    'pages' : IDL.Nat32,
    'hydrated' : IDL.Nat32,
    'textual_checked' : IDL.Nat32,
    'adopted_listed' : IDL.Nat32,
  });
  const ActivityLifecycle = IDL.Variant({
    'Open' : IDL.Null,
    'AdoptedPendingExecution' : IDL.Null,
  });
  const ActivityProposal = IDL.Record({
    'id' : IDL.Nat64,
    'title' : IDL.Opt(IDL.Text),
    'topic' : IDL.Int32,
    'function' : IDL.Opt(IDL.Int32),
    'target_subnet' : IDL.Opt(IDL.Principal),
    'lifecycle' : ActivityLifecycle,
    'motion' : IDL.Bool,
    'observed_at' : IDL.Nat64,
  });
  const LiveSubnetActivity = IDL.Record({
    'complete' : IDL.Bool,
    'matches' : IDL.Vec(ActivityMatch),
    'coverage' : ActivityCoverage,
    'proposals' : IDL.Vec(ActivityProposal),
  });
  const Result_42 = IDL.Variant({
    'Ok' : LiveSubnetActivity,
    'Err' : LiveError,
  });
  const LiveResponse_6 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_42,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_43 = IDL.Variant({ 'Ok' : LiveResponse_6, 'Err' : IDL.Text });
  const Subnet = IDL.Record({
    'members' : IDL.Vec(IDL.Principal),
    'kind' : IDL.Int32,
    'sev_enabled' : IDL.Bool,
  });
  const Record_3 = IDL.Variant({
    'Missing' : IDL.Null,
    'Present' : IDL.Record({ 'value' : Subnet, 'stamp' : RecordStamp }),
    'Deleted' : RecordStamp,
    'Unavailable' : IDL.Record({
      'stamp' : IDL.Opt(RecordStamp),
      'reason' : IDL.Text,
    }),
  });
  const LiveSubnetSnapshot = IDL.Record({
    'subnet' : IDL.Principal,
    'nodes' : IDL.Vec(IDL.Tuple(IDL.Principal, Record)),
    'operators' : IDL.Vec(IDL.Tuple(IDL.Principal, Record_1)),
    'membership' : Record_3,
    'data_centers' : IDL.Vec(IDL.Tuple(IDL.Text, Record_2)),
  });
  const Result_44 = IDL.Variant({
    'Ok' : LiveSubnetSnapshot,
    'Err' : LiveError,
  });
  const LiveResponse_7 = IDL.Record({
    'registry_version' : IDL.Opt(IDL.Nat64),
    'usage' : LiveUsage,
    'outcome' : Result_44,
    'receipts' : IDL.Vec(LiveReceipt),
  });
  const Result_45 = IDL.Variant({ 'Ok' : LiveResponse_7, 'Err' : IDL.Text });
  return IDL.Service({
    'advance_membership_review' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'authorize_verification' : IDL.Func([IDL.Nat64, Limits], [Result_1], []),
    'begin_membership_review' : IDL.Func([IDL.Vec(IDL.Nat64)], [Result_3], []),
    'capture_proposal' : IDL.Func([IDL.Nat64], [Result_1], []),
    'collection_status' : IDL.Func([], [Result_4], []),
    'compare_membership_context' : IDL.Func(
        [DetailComparisonInput, IDL.Vec(IDL.Nat8)],
        [Result_5],
        [],
      ),
    'compare_membership_details' : IDL.Func(
        [DetailComparisonInput],
        [Result_5],
        [],
      ),
    'compare_membership_with_policy' : IDL.Func(
        [DetailComparisonInput, IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
        [Result_5],
        [],
      ),
    'configure_collection' : IDL.Func([IDL.Opt(Limits)], [Result_1], []),
    'configure_collection_storage' : IDL.Func(
        [IDL.Opt(IDL.Nat64)],
        [Result_1],
        [],
      ),
    'configure_registry_limits' : IDL.Func([RegistryLimits], [Result_1], []),
    'discovery_status' : IDL.Func([], [Result_6], []),
    'evidence_bytes' : IDL.Func([IDL.Vec(IDL.Nat8), IDL.Nat32], [Result_7], []),
    'evidence_manifest' : IDL.Func(
        [IDL.Opt(IDL.Nat64), IDL.Vec(IDL.Nat64)],
        [Result_8],
        [],
      ),
    'finalize_membership_review' : IDL.Func(
        [IDL.Vec(IDL.Nat8)],
        [Result_10],
        [],
      ),
    'list_completed_reviews' : IDL.Func([], [IDL.Vec(CompletedReview)], []),
    'membership_context_detail_page' : IDL.Func(
        [IDL.Vec(IDL.Nat8), DetailKeys],
        [Result_12],
        [],
      ),
    'membership_detail_page' : IDL.Func(
        [IDL.Nat64, DetailKeys],
        [Result_12],
        [],
      ),
    'membership_registry_role' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result_14], []),
    'membership_review_page' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Nat32],
        [Result_7],
        [],
      ),
    'membership_review_scope' : IDL.Func([ScopeRequest], [Result_15], []),
    'membership_review_status' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'membership_target_topology' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Opt(IDL.Nat64)],
        [Result_17],
        [],
      ),
    'metric_conflicts' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Opt(IDL.Vec(IDL.Nat8))],
        [Result_18],
        [],
      ),
    'metric_sample_rows' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Opt(IDL.Principal)],
        [Result_19],
        [],
      ),
    'metric_samples' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Nat64, IDL.Opt(IDL.Nat64)],
        [Result_20],
        [],
      ),
    'metrics_roster' : IDL.Func([], [Result_21], []),
    'metrics_status' : IDL.Func([IDL.Principal], [Result_22], []),
    'node_performance_on_demand' : IDL.Func(
        [IDL.Principal, IDL.Nat64, IDL.Opt(IDL.Vec(IDL.Principal))],
        [Result_24],
        [],
      ),
    'probe_budget' : IDL.Func([IDL.Nat64], [Result_25], []),
    'probe_receipt' : IDL.Func([IDL.Nat64, IDL.Nat32], [Result_26], []),
    'probe_reply' : IDL.Func([IDL.Nat64, IDL.Nat32, IDL.Nat32], [Result_7], []),
    'probe_status' : IDL.Func([IDL.Nat64], [Result_27], []),
    'proposal_action' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Nat64)],
        [Result_28],
        [],
      ),
    'proposal_archive' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Nat64)],
        [Result_29],
        [],
      ),
    'proposal_history' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Nat64)],
        [Result_30],
        [],
      ),
    'proposal_status' : IDL.Func([IDL.Nat64], [Result_31], []),
    'read_membership_performance' : IDL.Func(
        [PerformanceRequest],
        [Result_32],
        [],
      ),
    'read_membership_review' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result_33], []),
    'registry_assignment' : IDL.Func(
        [IDL.Nat64, IDL.Principal],
        [Result_34],
        [],
      ),
    'registry_keys' : IDL.Func([IDL.Nat64, IDL.Opt(IDL.Text)], [Result_35], []),
    'registry_provider' : IDL.Func(
        [IDL.Nat64, IDL.Principal, IDL.Opt(IDL.Text)],
        [Result_36],
        [],
      ),
    'registry_record' : IDL.Func([IDL.Nat64, RecordKey], [Result_37], []),
    'registry_status' : IDL.Func([], [Result_38], []),
    'request_membership_review' : IDL.Func([ReviewRequest], [Result_39], []),
    'retry_registry' : IDL.Func([], [Result_1], []),
    'review_on_demand' : IDL.Func([IDL.Vec(IDL.Nat64)], [Result_3], []),
    'source_observation' : IDL.Func([IDL.Nat64], [Result_40], []),
    'start_probe' : IDL.Func([ProbeRequest], [Result_41], []),
    'start_probe_with_limits' : IDL.Func(
        [ProbeRequest, Limits],
        [Result_41],
        [],
      ),
    'subnet_activity' : IDL.Func([IDL.Vec(IDL.Nat64)], [Result_43], []),
    'subnet_snapshot_on_demand' : IDL.Func([IDL.Principal], [Result_45], []),
  });
};
export const init = ({ IDL }) => {
  const Sources = IDL.Record({
    'governance' : IDL.Principal,
    'registry' : IDL.Principal,
  });
  return [IDL.Opt(Sources)];
};
